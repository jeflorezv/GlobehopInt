/**
 * Phase 1 — Isolated Kling v2 quality test.
 *
 * PURPOSE: Confirm that the trial account can access kling-v2-1/pro, reveal the
 * unit cost per clip, and produce one clip you can compare against the v1/std
 * baseline before touching any production file.
 *
 * COST: ~1–2 Kling resource units per run. Do NOT loop this script.
 *       Run once, review the output, report back before running again.
 *
 * USAGE:
 *   1. Set IMAGE_URL below to any publicly reachable still image (Cloudinary URL works).
 *   2. Run:  node scripts/test-kling-v2.js
 *   3. The script prints units deducted and downloads the clip to /tmp/kling-v2-test.mp4
 */

import { createHmac }        from 'node:crypto';
import { writeFile }          from 'node:fs/promises';
import { KNOWN_NON_TERMINAL } from '../src/generate-reel.js';

// ─── CONFIG — edit before running ────────────────────────────────────────────

const IMAGE_URL = process.env.TEST_IMAGE_URL || '';

const TEST_VISUAL =
  'Young Latin American woman, 26, dark brown wavy hair to her shoulders, slim build, ' +
  'neutral confident expression, smart casual clothes, walking toward the Sydney Opera House, ' +
  'golden hour light, documentary photography style, 35mm lens, real skin texture, ' +
  'no text, no logos. 9:16 vertical.';

// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL        = process.env.KLING_API_BASE_URL ?? 'https://api.klingai.com';
const POLL_INTERVAL   = 15_000;
const MAX_POLLS       = 32;

const NEGATIVE_PROMPT =
  'warped or fused fingers, extra or missing fingers, floating limbs, phantom limbs, disembodied arm, ' +
  'morphing or shifting background, melting architecture, unstable background, ' +
  'deformed face, distorted eyes, facial drift, expression morphing, ' +
  'camera movement, camera shake, camera pan, camera zoom';

const MOTION_PROMPT =
  `${TEST_VISUAL} ` +
  'CAMERA FULLY LOCKED — absolutely no pan, no zoom, no push-in, no camera movement whatsoever. ' +
  'Micro motion only on the subject: subtle breathing, gentle natural blink, very slight hair movement from a soft breeze. ' +
  'Hands completely still and relaxed — no gesturing, no gripping, fingers not animated. ' +
  'Face stays neutral and natural — no talking, no laughing, no smiling changes, no expression morphing. ' +
  'Background is completely static. Documentary realism, no AI artifacts.';

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

async function run() {
  if (!IMAGE_URL) {
    console.error('ERROR: Set TEST_IMAGE_URL env var to a public image URL before running.');
    console.error('  Example: TEST_IMAGE_URL=https://res.cloudinary.com/... node scripts/test-kling-v2.js');
    process.exit(1);
  }

  if (!process.env.KLING_API_KEY || !process.env.KLING_API_SECRET) {
    console.error('ERROR: KLING_API_KEY and KLING_API_SECRET must be set.');
    process.exit(1);
  }

  console.log('=== Kling v2-1 / pro — Phase 1 test ===');
  console.log('Image URL:', IMAGE_URL);
  console.log('Model:     kling-v2-1 / pro / cfg_scale=0.5 / duration=5s');
  console.log('');
  console.log('Submitting task...');

  const submitResp = await fetch(`${BASE_URL}/v1/videos/image2video`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${klingJwt()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model_name:      'kling-v2-1',
      image:           IMAGE_URL,
      prompt:          MOTION_PROMPT,
      negative_prompt: NEGATIVE_PROMPT,
      duration:        '5',
      mode:            'pro',
      cfg_scale:       0.5,
    }),
  });

  const submitBody = await submitResp.json();

  if (!submitResp.ok) {
    console.error('Submit FAILED — HTTP', submitResp.status);
    console.error(JSON.stringify(submitBody, null, 2));
    console.error('');
    console.error('If status 403/400: kling-v2-1/pro is not accessible on this trial package.');
    console.error('Fall back to kling-v1 with Phase 0 improvements only.');
    process.exit(1);
  }

  const taskId = submitBody?.data?.task_id;
  if (!taskId) {
    console.error('No task_id in response:', JSON.stringify(submitBody, null, 2));
    process.exit(1);
  }

  console.log('Task submitted. task_id:', taskId);
  console.log('Polling every 15s (max', MAX_POLLS, 'attempts =', (MAX_POLLS * 15 / 60).toFixed(1), 'min)...');
  console.log('');

  for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    process.stdout.write(`  Poll ${attempt}/${MAX_POLLS}... `);

    const pollResp = await fetch(`${BASE_URL}/v1/videos/image2video/${taskId}`, {
      headers: { Authorization: `Bearer ${klingJwt()}` },
    });

    const json = await pollResp.json();
    const status   = json?.data?.task_status;
    const videoUrl = json?.data?.task_result?.videos?.[0]?.url;

    process.stdout.write(`status=${status}\n`);

    if (status === 'succeed' && videoUrl) {
      console.log('');
      console.log('SUCCESS');
      console.log('Video URL:', videoUrl);

      // Check unit cost if available in response
      const cost = json?.data?.task_info?.cost ?? json?.data?.cost;
      if (cost !== undefined) {
        console.log('Units deducted:', cost);
      } else {
        console.log('Units deducted: not reported in response — check Kling dashboard.');
      }

      console.log('');
      console.log('Downloading clip to /tmp/kling-v2-test.mp4...');
      const videoResp = await fetch(videoUrl);
      const buffer    = Buffer.from(await videoResp.arrayBuffer());
      await writeFile('/tmp/kling-v2-test.mp4', buffer);
      console.log('Saved: /tmp/kling-v2-test.mp4');
      console.log('');
      console.log('NEXT STEPS:');
      console.log('  1. Review /tmp/kling-v2-test.mp4 for artifact quality.');
      console.log('  2. Check Kling dashboard for exact unit cost.');
      console.log('  3. Report back — then decide whether to update production model_name/mode.');
      return;
    }

    if (status === 'failed') {
      console.error('Task FAILED.');
      console.error(JSON.stringify(json?.data, null, 2));
      process.exit(1);
    }

    if (!KNOWN_NON_TERMINAL.has(status)) {
      console.error(`Unrecognized status "${status}" — stopping.`);
      console.error(JSON.stringify(json?.data, null, 2));
      process.exit(1);
    }
  }

  console.error(`Timed out after ${MAX_POLLS * POLL_INTERVAL / 1000}s.`);
  console.error('The task may still be running — check the Kling dashboard with task_id:', taskId);
  process.exit(1);
}

run().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
