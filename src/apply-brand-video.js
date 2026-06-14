import { execFile }    from 'node:child_process';
import { promisify }   from 'node:util';
import { randomUUID }  from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import path            from 'node:path';
import { createOverlayPng } from './apply-brand.js';
import { uploadVideoToCdn } from './upload-cdn.js';

const execFileAsync = promisify(execFile);

/**
 * Downloads a raw Kling video, composites the GlobeHop gradient/text/logo
 * overlay via FFmpeg, uploads the branded video to Cloudinary, and returns
 * the permanent HTTPS URL.
 *
 * This is called AFTER Kling returns a video so the AI never processes the
 * branding elements — preventing the distortion/disappearance seen in V3.
 *
 * @param {string} videoUrl  Raw Kling video URL
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

    // 2. Get exact video dimensions via ffprobe
    const { width, height } = await getVideoDimensions(rawPath);
    console.log(`[brand-video] frame size ${width}×${height}`);

    // 3. Generate transparent overlay PNG at matching dimensions
    overlayPath = await createOverlayPng(width, height, hookText);

    // 4. FFmpeg: composite overlay over every frame
    await execFileAsync('ffmpeg', [
      '-i',      rawPath,
      '-i',      overlayPath,
      '-filter_complex', '[0:v][1:v]overlay=0:0[v]',
      '-map',    '[v]',
      '-map',    '0:a?',         // copy audio if present, skip silently if not
      '-c:v',    'libx264',
      '-preset', 'fast',
      '-crf',    '23',
      '-pix_fmt','yuv420p',      // required for Instagram compatibility
      '-c:a',    'aac',
      '-y',
      outPath,
    ]);

    // 5. Upload branded video to Cloudinary
    return await uploadVideoToCdn(outPath, path.basename(outPath));

  } finally {
    for (const p of [rawPath, outPath, overlayPath]) {
      if (p) unlink(p).catch(() => {});
    }
  }
}

async function getVideoDimensions(videoPath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',              'error',
    '-select_streams', 'v:0',
    '-show_entries',   'stream=width,height',
    '-of',             'json',
    videoPath,
  ]);

  const json   = JSON.parse(stdout);
  const stream = json?.streams?.[0];
  if (!stream?.width || !stream?.height) {
    throw new Error(`ffprobe: could not read dimensions from ${videoPath}`);
  }
  return { width: stream.width, height: stream.height };
}
