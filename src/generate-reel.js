import { createHmac } from 'node:crypto';
import { withRetry } from './utils/retry.js';

if (!process.env.KLING_API_KEY || !process.env.KLING_API_SECRET) {
  throw new Error('[generate-reel] KLING_API_KEY and KLING_API_SECRET must be set in environment');
}

const BASE_URL             = process.env.KLING_API_BASE_URL ?? 'https://api.klingai.com';
const POLL_INTERVAL_MS     = 15_000;
const MAX_POLLS            = 32; // ~8 min — covers kling-v2-1/pro render times
export const KNOWN_NON_TERMINAL = new Set(['submitted', 'processing']);

const NEGATIVE_PROMPT =
  'warped or fused fingers, extra or missing fingers, floating limbs, phantom limbs, disembodied arm, ' +
  'morphing or shifting background, melting architecture, unstable background, ' +
  'deformed face, distorted eyes, facial drift, expression morphing, ' +
  'camera movement, camera shake, camera pan, camera zoom';

function klingJwt() {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now     = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: process.env.KLING_API_KEY,
    exp: now + 1800,
    nbf: now - 30,
  })).toString('base64url');
  const sig = createHmac('sha256', process.env.KLING_API_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/**
 * Submits an image-to-video task to Kling and polls until the video is ready.
 * Called as the `video` step in the reel pipeline. Receives a CDN-hosted clean
 * image (no Sharp overlays) — branding (logo, text, music) is applied by FFmpeg
 * in applyBrandToVideo after this function returns.
 *
 * ctx.imageUrl must be a publicly reachable CDN URL because Kling downloads it server-side.
 *
 * @param {object} record  Airtable record — unused here; accepted for pipeline step interface consistency
 * @param {object} ctx     Pipeline context — must contain ctx.imageUrl and ctx.visual
 * @returns {Promise<object>} { ...ctx, videoUrl }
 */
export async function generateReel(record, ctx) {
  if (!ctx.imageUrl) throw new Error('generate-reel: ctx.imageUrl is required');
  if (!ctx.visual)   throw new Error('generate-reel: ctx.visual is required');

  const taskId  = await submitTask(ctx.imageUrl, ctx.visual);
  const videoUrl = await pollUntilDone(taskId);

  return { ...ctx, videoUrl };
}

async function submitTask(imageUrl, visualPrompt) {
  return withRetry(async () => {
    const resp = await fetch(`${BASE_URL}/v1/videos/image2video`, {
      method: 'POST',
      signal:  AbortSignal.timeout(30_000),
      headers: {
        Authorization:  `Bearer ${klingJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_name:      'kling-v2-1',
        image:           imageUrl,
        prompt:          motionPrompt(visualPrompt),
        negative_prompt: NEGATIVE_PROMPT,
        duration:        '5',
        mode:            'pro',
        cfg_scale:       0.5,
        // aspect_ratio is inferred from the source image — Ideogram already
        // outputs ASPECT_9_16 for reels, so no explicit param is needed here.
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[generate-reel] Kling submit ${resp.status} body:`, body);
      const err  = new Error(`Kling submit failed (HTTP ${resp.status})`);
      err.status = resp.status;
      throw err;
    }

    const json   = await resp.json();
    const taskId = json?.data?.task_id;
    if (!taskId) throw new Error('Kling: no task_id in submit response (check Railway logs)');
    return taskId;
  });
}

async function pollUntilDone(taskId) {
  for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const json = await withRetry(async () => {
      const resp = await fetch(`${BASE_URL}/v1/videos/image2video/${taskId}`, {
        signal:  AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${klingJwt()}` },
      });

      if (!resp.ok) {
        const body = await resp.text();
        console.error(`[generate-reel] Kling poll ${resp.status} body:`, body);
        const err  = new Error(`Kling poll failed (HTTP ${resp.status})`);
        err.status = resp.status;
        throw err;
      }

      return resp.json();
    });

    const status   = json?.data?.task_status;
    const videoUrl = json?.data?.task_result?.videos?.[0]?.url;

    if (status === 'succeed') {
      if (!videoUrl) {
        console.error(`[generate-reel] Kling task ${taskId} succeeded but returned no video URL:`, JSON.stringify(json?.data));
        throw new Error(`Kling: task ${taskId} succeeded but response contained no video URL`);
      }
      return videoUrl;
    }

    if (status === 'failed') {
      console.error(`[generate-reel] Kling task ${taskId} failed:`, JSON.stringify(json?.data));
      throw new Error(`Kling: task ${taskId} failed (check Railway logs)`);
    }

    if (!KNOWN_NON_TERMINAL.has(status)) {
      console.error(`[generate-reel] Kling task ${taskId} unknown status "${status}":`, JSON.stringify(json?.data));
      throw new Error(`Kling: task ${taskId} returned unrecognized status "${status}"`);
    }

    // known non-terminal status — continue polling
  }

  const elapsed = (MAX_POLLS * POLL_INTERVAL_MS) / 1000;
  throw new Error(`Kling: task ${taskId} timed out after ${elapsed}s`);
}

// Derives a Kling motion prompt from the static image.
// CAMERA LOCKED = prevents background morph artifacts.
// Hands/fingers explicit = prevents finger-fusion blobs.
// No facial movement = prevents face drift and expression morphing.
function motionPrompt(visualPrompt) {
  return (
    `${visualPrompt} ` +
    'CAMERA FULLY LOCKED — absolutely no pan, no zoom, no push-in, no camera movement whatsoever. ' +
    'Micro motion only on the subject: subtle breathing, gentle natural blink, very slight hair movement from a soft breeze. ' +
    'Hands completely still and relaxed — no gesturing, no gripping, fingers not animated. ' +
    'Face stays neutral and natural — no talking, no laughing, no smiling changes, no expression morphing. ' +
    'Background is completely static. Documentary realism, no AI artifacts.'
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
