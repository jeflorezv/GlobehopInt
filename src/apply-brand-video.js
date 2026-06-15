import { execFile }    from 'node:child_process';
import { promisify }   from 'node:util';
import { randomUUID }  from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import path            from 'node:path';
import { createOverlayPng, createEndCardPng } from './apply-brand.js';
import { uploadVideoToCdn } from './upload-cdn.js';

const execFileAsync = promisify(execFile);
const TARGET_W      = 1080;
const TARGET_H      = 1920;
const SCENE_SECS    = 3.5;  // each Kling clip trimmed to this length
const END_CARD_SECS = 2;    // branded end card duration

/**
 * Post-processes Kling video(s) with GlobeHop branding and uploads to Cloudinary.
 *
 * Single URL  → single-scene mode: overlay applied, same as before.
 * Array of URLs → 4-scene mode: scene 1 gets overlay, scenes 2–3 are clean,
 *                 a branded end card is appended, all concatenated.
 *
 * @param {string|string[]} videoUrls  Raw Kling video URL(s)
 * @param {string|null}     hookText   3-line hook (lines separated by \n)
 * @returns {Promise<string>} Cloudinary URL of the final branded video
 */
export async function applyBrandToVideo(videoUrls, hookText = null) {
  const urls = Array.isArray(videoUrls) ? videoUrls : [videoUrls];
  return urls.length > 1
    ? assembleMultiScene(urls, hookText)
    : assembleSingleScene(urls[0], hookText);
}

// ─── single-scene (original flow, kept for compatibility) ─────────────────────

async function assembleSingleScene(videoUrl, hookText) {
  const rawPath  = path.join('/tmp', `kling-${randomUUID()}.mp4`);
  const outPath  = path.join('/tmp', `branded-${randomUUID()}.mp4`);
  let overlayPath = null;

  try {
    const resp = await fetch(videoUrl);
    if (!resp.ok) throw new Error(`Failed to fetch Kling video: ${resp.status} ${videoUrl}`);
    await writeFile(rawPath, Buffer.from(await resp.arrayBuffer()));

    overlayPath = await createOverlayPng(TARGET_W, TARGET_H, hookText);

    try {
      await execFileAsync('ffmpeg', [
        '-i',      rawPath,
        '-filter_complex',
          `movie=${overlayPath},loop=loop=-1:size=1:start=0[ovrl];` +
          `[0:v]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,` +
          `crop=${TARGET_W}:${TARGET_H},fps=30[base];` +
          `[base][ovrl]overlay=0:0:shortest=1[v]`,
        '-map',      '[v]',
        '-an',
        '-c:v',      'libx264',
        '-preset',   'fast',
        '-crf',      '23',
        '-pix_fmt',  'yuv420p',
        '-threads',  '2',
        '-movflags', '+faststart',
        '-y',
        outPath,
      ], { maxBuffer: 10 * 1024 * 1024 });
    } catch (ffErr) {
      throw new Error(`FFmpeg failed:\n${ffErr.stderr || ffErr.message}`);
    }

    return await uploadVideoToCdn(outPath, path.basename(outPath));

  } finally {
    for (const p of [rawPath, outPath, overlayPath]) {
      if (p) unlink(p).catch(() => {});
    }
  }
}

// ─── 4-scene assembly ─────────────────────────────────────────────────────────

async function assembleMultiScene(videoUrls, hookText) {
  const id = randomUUID();

  const rawPaths       = videoUrls.map((_, i) => path.join('/tmp', `kling-${id}-${i}.mp4`));
  const processedPaths = videoUrls.map((_, i) => path.join('/tmp', `scene-${id}-${i}.mp4`));
  const endCardMp4     = path.join('/tmp', `endcard-${id}.mp4`);
  const concatList     = path.join('/tmp', `concat-${id}.txt`);
  const outPath        = path.join('/tmp', `final-${id}.mp4`);

  let overlayPath  = null;
  let endCardPng   = null;

  const toClean = [...rawPaths, ...processedPaths, endCardMp4, concatList, outPath];

  try {
    // 1. Download all Kling clips in parallel
    await Promise.all(videoUrls.map(async (url, i) => {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to fetch Kling clip ${i + 1}: ${resp.status}`);
      await writeFile(rawPaths[i], Buffer.from(await resp.arrayBuffer()));
    }));

    // 2. Generate overlay PNG (applied to scene 1 only)
    overlayPath = await createOverlayPng(TARGET_W, TARGET_H, hookText);
    toClean.push(overlayPath);

    // 3. Process clips sequentially:
    //    scene 1 → trim + scale + overlay branding
    //    scenes 2–N → trim + scale only (clean video, no text)
    await processClipWithOverlay(rawPaths[0], overlayPath, processedPaths[0]);
    for (let i = 1; i < rawPaths.length; i++) {
      await processClipClean(rawPaths[i], processedPaths[i]);
    }

    // 4. Generate end card: Sharp PNG → 2-second MP4
    const ctaLine = hookText ? hookText.split('\n').at(-1) : null;
    endCardPng = await createEndCardPng(TARGET_W, TARGET_H, ctaLine);
    toClean.push(endCardPng);
    await generateEndCardVideo(endCardPng, endCardMp4);

    // 5. Write concat list and merge (stream copy — fast, lossless)
    const lines = [...processedPaths, endCardMp4].map(p => `file '${p}'`).join('\n');
    await writeFile(concatList, lines);

    try {
      await execFileAsync('ffmpeg', [
        '-f',    'concat',
        '-safe', '0',
        '-i',    concatList,
        '-c',    'copy',
        '-y',
        outPath,
      ], { maxBuffer: 10 * 1024 * 1024 });
    } catch (ffErr) {
      throw new Error(`FFmpeg concat failed:\n${ffErr.stderr || ffErr.message}`);
    }

    return await uploadVideoToCdn(outPath, path.basename(outPath));

  } finally {
    for (const p of toClean) {
      if (p) unlink(p).catch(() => {});
    }
  }
}

// ─── FFmpeg helpers ───────────────────────────────────────────────────────────

async function processClipWithOverlay(inputPath, overlayPath, outputPath) {
  try {
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-filter_complex',
        `movie=${overlayPath},loop=loop=-1:size=1:start=0[ovrl];` +
        `[0:v]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,` +
        `crop=${TARGET_W}:${TARGET_H},fps=30,` +
        `trim=duration=${SCENE_SECS},setpts=PTS-STARTPTS[base];` +
        `[base][ovrl]overlay=0:0:shortest=1[v]`,
      '-map', '[v]',
      '-an',
      '-c:v',      'libx264',
      '-preset',   'fast',
      '-crf',      '23',
      '-pix_fmt',  'yuv420p',
      '-threads',  '2',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ], { maxBuffer: 10 * 1024 * 1024 });
  } catch (ffErr) {
    throw new Error(`FFmpeg scene overlay failed:\n${ffErr.stderr || ffErr.message}`);
  }
}

async function processClipClean(inputPath, outputPath) {
  try {
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-vf',
        `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,` +
        `crop=${TARGET_W}:${TARGET_H},fps=30,trim=duration=${SCENE_SECS},setpts=PTS-STARTPTS`,
      '-an',
      '-c:v',      'libx264',
      '-preset',   'fast',
      '-crf',      '23',
      '-pix_fmt',  'yuv420p',
      '-threads',  '2',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ], { maxBuffer: 10 * 1024 * 1024 });
  } catch (ffErr) {
    throw new Error(`FFmpeg clean clip failed:\n${ffErr.stderr || ffErr.message}`);
  }
}

async function generateEndCardVideo(pngPath, outputPath) {
  try {
    await execFileAsync('ffmpeg', [
      '-filter_complex',
        `movie=${pngPath},loop=loop=-1:size=1:start=0,` +
        `trim=duration=${END_CARD_SECS},setpts=PTS-STARTPTS,fps=30,` +
        `scale=${TARGET_W}:${TARGET_H}[v]`,
      '-map', '[v]',
      '-an',
      '-c:v',      'libx264',
      '-preset',   'fast',
      '-crf',      '23',
      '-pix_fmt',  'yuv420p',
      '-threads',  '2',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ], { maxBuffer: 10 * 1024 * 1024 });
  } catch (ffErr) {
    throw new Error(`FFmpeg end card failed:\n${ffErr.stderr || ffErr.message}`);
  }
}
