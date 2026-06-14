import { createHmac } from 'node:crypto';
import { withRetry } from './utils/retry.js';

const BASE_URL         = process.env.KLING_API_BASE_URL ?? 'https://api.klingai.com';
const POLL_INTERVAL_MS = 15_000; // 15 s between polls
const MAX_POLLS        = 20;     // 5-minute window total (Kling v1 typically needs 2–4 min)

function klingJwt() {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now     = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: process.env.KLING_API_KEY,
    exp: now + 1800,
    nbf: now - 5,
  })).toString('base64url');
  const sig = createHmac('sha256', process.env.KLING_API_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/**
 * Submits an image-to-video task to Kling and polls until the video is ready.
 * Called as the `video` step in the reel pipeline, after apply-brand.
 *
 * ctx.imageUrl must be a publicly reachable URL (Railway /images/:filename)
 * because Kling downloads it server-side.
 *
 * @param {object} record  Raw Airtable record fields
 * @param {object} ctx     Pipeline context — must contain ctx.imageUrl and ctx.visual
 * @returns {Promise<object>} { ...ctx, videoUrl }
 */
export async function generateReel(record, ctx) {
  if (!ctx.imageUrl) throw new Error('generate-reel: ctx.imageUrl is required');

  const taskId  = await submitTask(ctx.imageUrl, ctx.visual);
  const videoUrl = await pollUntilDone(taskId);

  return { ...ctx, videoUrl };
}

async function submitTask(imageUrl, visualPrompt) {
  return withRetry(async () => {
    const resp = await fetch(`${BASE_URL}/v1/videos/image2video`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${klingJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_name: 'kling-v1',
        image:      imageUrl,
        prompt:     motionPrompt(visualPrompt),
        duration:   '10',
        mode:       'std',
        cfg_scale:  0.5,
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

    if (status === 'succeed' && videoUrl) return videoUrl;

    if (status === 'failed') {
      console.error(`[generate-reel] Kling task ${taskId} failed:`, JSON.stringify(json?.data));
      throw new Error(`Kling: task ${taskId} failed (check Railway logs)`);
    }

    // status === 'processing' — continue polling
  }

  const elapsed = (MAX_POLLS * POLL_INTERVAL_MS) / 1000;
  throw new Error(`Kling: task ${taskId} timed out after ${elapsed}s`);
}

// Derives a motion description from the static image prompt.
// Keeps motion subtle — jarring movement looks unprofessional for educational content.
function motionPrompt(visualPrompt) {
  return `${visualPrompt} Gentle, natural camera movement. Slow cinematic push-in or subtle pan. Smooth and calm.`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
