import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { withRetry } from './utils/retry.js';
import { assertAllowedUrl } from './utils/fetch-guard.js';
import { uploadVideoToCdn } from './upload-cdn.js';

if (!process.env.GEMINI_API_KEY) {
  throw new Error('[generate-reel] GEMINI_API_KEY must be set in environment');
}

const API_KEY           = process.env.GEMINI_API_KEY;
const MODEL              = 'veo-3.1-generate-preview';
const API_BASE           = 'https://generativelanguage.googleapis.com/v1beta';
const POLL_INTERVAL_MS   = 10_000;
const MAX_POLLS          = 40; // ~6.7 min — comfortably covers observed 70–110s Veo render times
// Veo bills per second, identically regardless of resolution (verified against real
// Cloud Console billing: 720p and 1080p both A$4.45 per 8s clip) — the cost lever is
// duration, not resolution. But duration is itself resolution-gated: confirmed live
// against the API that 1080p only accepts durationSeconds:8 (its default), while 720p
// accepts 4 (odd values like 5 are rejected at any resolution — only even values
// validate). So 720p is the only way to get a shorter, cheaper clip at all — this
// roughly halves cost (~A$77/mo -> ~A$38/mo at 1 reel/week) at the cost of resolution
// AND total reel length (4 scenes x 4s = 16s instead of 20s; see apply-brand-video.js
// SCENE_SECS, which must match this value).
const RESOLUTION          = '720p';
const DURATION_SECONDS    = 4;

const NEGATIVE_PROMPT =
  'warped or fused fingers, extra or missing fingers, floating limbs, phantom limbs, disembodied arm, ' +
  'morphing or shifting background, melting architecture, unstable background, ' +
  'deformed face, distorted eyes, facial drift, expression morphing, ' +
  'camera movement, camera shake, camera pan, camera zoom, ' +
  'talking, laughing mouth, mouth opening, dramatic movement, exaggerated expressions, ' +
  'fast motion, animated gestures, big smile morphing, speaking to camera';

/**
 * Submits an image-to-video task to Veo 3.1 and polls until the video is ready,
 * then persists it to Cloudinary (Veo's own file URLs require an auth header
 * and expire, so downstream steps — apply-brand-video.js — must never see them).
 * Called as the `video` step in the reel pipeline.
 *
 * ctx.imageUrl must be a publicly reachable CDN URL — this function downloads
 * it to embed as base64 (Veo's image-to-video API takes inline image bytes,
 * not a URL Veo fetches server-side, unlike the previous Kling integration).
 *
 * @param {object} record  Airtable record — unused here; accepted for pipeline step interface consistency
 * @param {object} ctx     Pipeline context — must contain ctx.imageUrl and ctx.visual
 * @returns {Promise<object>} { ...ctx, videoUrl }
 */
export async function generateReel(record, ctx) {
  if (!ctx.imageUrl) throw new Error('generate-reel: ctx.imageUrl is required');
  if (!ctx.visual)   throw new Error('generate-reel: ctx.visual is required');

  const imageBytes = await fetchImageAsBase64(ctx.imageUrl);
  const operationName = await submitTask(imageBytes, motionPrompt(ctx.visual));
  const veoVideoUri = await pollUntilDone(operationName);
  const videoUrl = await persistToCdn(veoVideoUri);

  return { ...ctx, videoUrl };
}

async function fetchImageAsBase64(imageUrl) {
  assertAllowedUrl(imageUrl, 'generate-reel');
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`generate-reel: failed to fetch source image (HTTP ${resp.status})`);
  return Buffer.from(await resp.arrayBuffer()).toString('base64');
}

async function submitTask(imageBytes, prompt, personGeneration = 'allow_adult', durationSeconds = DURATION_SECONDS) {
  return withRetry(async () => {
    const parameters = {
      aspectRatio: '9:16',
      negativePrompt: NEGATIVE_PROMPT,
      resolution: RESOLUTION,
    };
    if (personGeneration) parameters.personGeneration = personGeneration;
    if (durationSeconds)  parameters.durationSeconds = durationSeconds;

    const resp = await fetch(`${API_BASE}/models/${MODEL}:predictLongRunning`, {
      method: 'POST',
      signal:  AbortSignal.timeout(30_000),
      headers: {
        'x-goog-api-key': API_KEY,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({
        instances: [{ prompt, image: { bytesBase64Encoded: imageBytes, mimeType: 'image/png' } }],
        parameters,
      }),
    });

    const json = await resp.json();

    if (!resp.ok) {
      // Some accounts/regions reject personGeneration:'allow_adult' outright —
      // retry once with the model default rather than failing the whole scene.
      if (personGeneration && String(json?.error?.message).includes('personGeneration')) {
        console.warn('[generate-reel] personGeneration:allow_adult rejected, retrying without it');
        return submitTask(imageBytes, prompt, null, durationSeconds);
      }
      // Veo may only support enumerated durations (e.g. 4/6/8s) rather than an
      // arbitrary 5 — fall back to the model default (8s) rather than fail the scene.
      // This costs more (see generate-reel.js DURATION_SECONDS comment) but still works.
      if (durationSeconds && String(json?.error?.message).toLowerCase().includes('duration')) {
        console.warn(`[generate-reel] durationSeconds:${durationSeconds} rejected, retrying with model default`);
        return submitTask(imageBytes, prompt, personGeneration, null);
      }
      console.error(`[generate-reel] Veo submit ${resp.status} body:`, JSON.stringify(json));
      const err  = new Error(`Veo submit failed (HTTP ${resp.status}): ${json?.error?.message ?? 'unknown error'}`);
      err.status = resp.status;
      throw err;
    }

    if (!json.name) throw new Error('Veo: no operation name in submit response (check Railway logs)');
    return json.name;
  });
}

async function pollUntilDone(operationName) {
  const url = `${API_BASE}/${operationName}`;

  for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const json = await withRetry(async () => {
      const resp = await fetch(url, {
        signal:  AbortSignal.timeout(20_000),
        headers: { 'x-goog-api-key': API_KEY },
      });

      const body = await resp.json();
      if (!resp.ok) {
        console.error(`[generate-reel] Veo poll ${resp.status} body:`, JSON.stringify(body));
        const err  = new Error(`Veo poll failed (HTTP ${resp.status})`);
        err.status = resp.status;
        throw err;
      }
      return body;
    });

    if (json.error) {
      console.error(`[generate-reel] Veo operation ${operationName} failed:`, JSON.stringify(json.error));
      throw new Error(`Veo: operation failed — ${json.error.message ?? 'unknown error'}`);
    }

    if (json.done) {
      const videoUri = json?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!videoUri) {
        console.error(`[generate-reel] Veo operation ${operationName} done but no video URI:`, JSON.stringify(json.response));
        throw new Error(`Veo: operation ${operationName} completed but response contained no video URI`);
      }
      return videoUri;
    }

    // done: false — keep polling
  }

  const elapsed = (MAX_POLLS * POLL_INTERVAL_MS) / 1000;
  throw new Error(`Veo: operation ${operationName} timed out after ${elapsed}s`);
}

async function persistToCdn(veoVideoUri) {
  assertAllowedUrl(veoVideoUri, 'generate-reel');
  const resp = await fetch(veoVideoUri, { headers: { 'x-goog-api-key': API_KEY } });
  if (!resp.ok) throw new Error(`generate-reel: failed to download Veo clip (HTTP ${resp.status})`);

  const tmpPath = `/tmp/veo-${randomUUID()}.mp4`;
  try {
    await writeFile(tmpPath, Buffer.from(await resp.arrayBuffer()));
    return await uploadVideoToCdn(tmpPath, `veo-${randomUUID()}.mp4`);
  } finally {
    unlink(tmpPath).catch(() => {});
  }
}

// Derives a Veo motion prompt from the static image.
// CAMERA LOCKED = prevents background morph artifacts.
// Hands/fingers explicit = prevents finger-fusion blobs.
// No facial movement = prevents face drift and expression morphing.
function motionPrompt(visualPrompt) {
  return (
    `${visualPrompt} ` +
    'Camera fully locked — completely static, no pan, no zoom, no push-in, no handheld movement whatsoever. ' +
    'Realistic human movement, natural physics, high realism, authentic movement, no exaggerated facial expressions. ' +
    'Micro motion only on the subject: subtle breathing, gentle natural blink, very slight hair movement from a soft breeze. ' +
    'Hands completely still and relaxed — no gesturing, no gripping, fingers not animated. ' +
    'Face stays neutral and natural — no talking, no laughing, no smiling changes, no expression morphing. ' +
    'Background is completely static. Documentary realism, no AI artifacts.'
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
