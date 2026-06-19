/**
 * Zero-cost reel overlay preview.
 *
 * Composites all 4 scene overlays (logo + text) onto a real 9:16 image
 * and saves JPEGs to /tmp so you can check layout before spending Kling units.
 *
 * No API calls — Sharp only.
 *
 * Usage:
 *   node scripts/preview-reel-overlays.js
 *
 * Output (open in Preview / Finder):
 *   /tmp/preview-scene1-hook.jpg
 *   /tmp/preview-scene2-study.jpg
 *   /tmp/preview-scene3-student-life.jpg
 *   /tmp/preview-scene4-cta.jpg
 */

import { config }        from 'dotenv';
import sharp             from 'sharp';
import { execFile }      from 'node:child_process';
import { promisify }     from 'node:util';
import {
  createOverlayPng,
  createSimpleTextPng,
  createEndCardPng,
} from '../src/apply-brand.js';

config({ path: new URL('../.env', import.meta.url) });

const execFileAsync = promisify(execFile);

const W = 1080;
const H = 1920;

// A real Cloudinary image transformed to 9:16 via URL param — no extra cost.
const BASE_IMAGE_URL =
  'https://res.cloudinary.com/dfrqjkt9b/image/upload/c_fill,w_1080,h_1920/v1781770127/mdq0wxnpa3toaexlz56p.jpg';

// ─── Sample scene text — edit these to match a real Claude output ─────────────

const HOOK_TEXT =
  'La mejor versión de ti está aquí.\n' +
  'Un vuelo te separa de quien puedes ser.\n' +
  'Escribe «AUSTRALIA» al DM';

const SCENE2_TEXT = 'Hoy estudia en Australia 🇦🇺';

const SCENE3_TEXT = 'Nuevos amigos.\nNueva vida.';

// Scene 4 CTA — 3 lines matching the scene_cta format
const SCENE4_TEXT =
  '¿Quieres estudiar en Australia?\n' +
  'Escribe AUSTRALIA 🇦🇺\n' +
  'Consulta gratuita';

// ─────────────────────────────────────────────────────────────────────────────

async function composite(overlayPath, outPath) {
  const resp = await fetch(BASE_IMAGE_URL);
  if (!resp.ok) throw new Error(`Failed to fetch base image: ${resp.status}`);
  const baseBuf = Buffer.from(await resp.arrayBuffer());

  await sharp(baseBuf)
    .resize(W, H, { fit: 'cover' })
    .composite([{ input: overlayPath, blend: 'over' }])
    .jpeg({ quality: 90 })
    .toFile(outPath);
}

async function run() {
  console.log('Generating overlay previews (Sharp only — no API calls)...\n');

  console.log('Scene 1 — Hook overlay...');
  const s1overlay = await createOverlayPng(W, H, HOOK_TEXT);
  await composite(s1overlay, '/tmp/preview-scene1-hook.jpg');
  console.log('  → /tmp/preview-scene1-hook.jpg');

  console.log('Scene 2 — Study overlay...');
  const s2overlay = await createSimpleTextPng(W, H, SCENE2_TEXT);
  await composite(s2overlay, '/tmp/preview-scene2-study.jpg');
  console.log('  → /tmp/preview-scene2-study.jpg');

  console.log('Scene 3 — Student life overlay...');
  const s3overlay = await createSimpleTextPng(W, H, SCENE3_TEXT);
  await composite(s3overlay, '/tmp/preview-scene3-student-life.jpg');
  console.log('  → /tmp/preview-scene3-student-life.jpg');

  console.log('Scene 4 — CTA overlay...');
  const s4overlay = await createOverlayPng(W, H, SCENE4_TEXT);
  await composite(s4overlay, '/tmp/preview-scene4-cta.jpg');
  console.log('  → /tmp/preview-scene4-cta.jpg');

  console.log('\nOpening previews...');
  await execFileAsync('open', [
    '/tmp/preview-scene1-hook.jpg',
    '/tmp/preview-scene2-study.jpg',
    '/tmp/preview-scene3-student-life.jpg',
    '/tmp/preview-scene4-cta.jpg',
  ]);

  console.log('\nDone. Edit HOOK_TEXT / SCENE*_TEXT at the top of this script to adjust copy.');
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
