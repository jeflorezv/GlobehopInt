import { execFile }    from 'node:child_process';
import { promisify }   from 'node:util';
import { randomUUID }  from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import path            from 'node:path';
import { createOverlayPng } from './apply-brand.js';
import { uploadVideoToCdn } from './upload-cdn.js';

const execFileAsync = promisify(execFile);

// Instagram Reels standard: 1080×1920 @ 30fps
const TARGET_W = 1080;
const TARGET_H = 1920;

/**
 * Downloads a raw Kling video, normalizes it to 1080×1920 @ 30fps, composites
 * the GlobeHop gradient/text/logo overlay via FFmpeg, uploads to Cloudinary,
 * and returns the permanent HTTPS URL.
 *
 * Overlay is applied AFTER Kling generates the video so the AI never processes
 * the branding elements — preventing the distortion/disappearance seen in V3.
 *
 * @param {string} videoUrl   Raw Kling video URL
 * @param {string|null} hookText  Two-line hook (lines separated by \n)
 * @returns {Promise<string>} Cloudinary URL of the branded video
 */
export async function applyBrandToVideo(videoUrl, hookText = null) {
  const rawPath = path.join('/tmp', `kling-${randomUUID()}.mp4`);
  const outPath = path.join('/tmp', `branded-${randomUUID()}.mp4`);
  let overlayPath = null;

  try {
    // 1. Download Kling video
    const resp = await fetch(videoUrl);
    if (!resp.ok) throw new Error(`Failed to fetch Kling video: ${resp.status} ${videoUrl}`);
    await writeFile(rawPath, Buffer.from(await resp.arrayBuffer()));

    // 2. Generate transparent overlay at Instagram Reels standard dimensions
    overlayPath = await createOverlayPng(TARGET_W, TARGET_H, hookText);

    // 3. FFmpeg: normalize to 1080×1920 @ 30fps, composite overlay, prepare for streaming
    try {
      // Use `movie` filter inside the filtergraph to load the overlay PNG, then
      // `loop` to repeat it for the full video duration. This avoids the
      // multi-input thread queue deadlock (frame=0 hang) seen in FFmpeg 6.x when
      // a still-image second input can't sync with the video input thread.
      // overlay=shortest=1 stops compositing when the video ends.
      // -threads 2 prevents OOM from auto-spawning 60+ libx264 threads on Railway.
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

    // 4. Upload branded video to Cloudinary
    return await uploadVideoToCdn(outPath, path.basename(outPath));

  } finally {
    for (const p of [rawPath, outPath, overlayPath]) {
      if (p) unlink(p).catch(() => {});
    }
  }
}
