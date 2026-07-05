import { execFile }    from 'node:child_process';
import { promisify }   from 'node:util';
import { randomUUID }  from 'node:crypto';
import { writeFile, unlink, readdir } from 'node:fs/promises';
import path            from 'node:path';
import { createOverlayPng, createSimpleTextPng } from './apply-brand.js';
import { uploadVideoToCdn } from './upload-cdn.js';
import { assertAllowedUrl } from './utils/fetch-guard.js';

const execFileAsync = promisify(execFile);
const TARGET_W      = 1080;
const TARGET_H      = 1920;
const SCENE_SECS    = 5;     // use full Kling clip — 4 scenes × 5s = 20s total reel
const MUSIC_DIR     = path.resolve('./assets/music');
const MUSIC_VOLUME  = 0.15;  // 15% — music sits under any future voiceover

/**
 * Post-processes Kling video(s) with GlobeHop branding and uploads to Cloudinary.
 *
 * Single URL  → single-scene mode (legacy/fallback): hook overlay applied.
 * Array of URLs → multi-scene mode: per-scene overlays, optional music track.
 *   Scene 1 (hook):         full 3-level gradient + hook text
 *   Scenes 2…N-1 (middle):  simple text pill overlay
 *   Scene N (cta):          3-level overlay reused with CTA text from scenes array
 *
 * Music: if assets/music/ contains any .mp3/.m4a/.aac file, it is looped and
 * mixed in at MUSIC_VOLUME. No file → silent output.
 *
 * @param {string|string[]} videoUrls  Raw Kling video URL(s)
 * @param {string|null}     hookText   3-line hook (\n-separated) for scene 1
 * @param {object[]|null}   scenes     Scene descriptors with .text fields
 * @returns {Promise<string>} Cloudinary URL of the final branded video
 */
export async function applyBrandToVideo(videoUrls, hookText = null, scenes = null) {
  const urls = Array.isArray(videoUrls) ? videoUrls : [videoUrls];
  return urls.length > 1
    ? assembleMultiScene(urls, hookText, scenes)
    : assembleSingleScene(urls[0], hookText);
}

// ─── single-scene (original flow, kept for compatibility) ─────────────────────

async function assembleSingleScene(videoUrl, hookText) {
  const rawPath    = path.join('/tmp', `kling-${randomUUID()}.mp4`);
  const outPath    = path.join('/tmp', `branded-${randomUUID()}.mp4`);
  let overlayPath  = null;

  try {
    assertAllowedUrl(videoUrl, 'apply-brand-video');
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

// ─── multi-scene assembly ─────────────────────────────────────────────────────

async function assembleMultiScene(videoUrls, hookText, scenes) {
  const id             = randomUUID();
  const rawPaths       = videoUrls.map((_, i) => path.join('/tmp', `kling-${id}-${i}.mp4`));
  const processedPaths = videoUrls.map((_, i) => path.join('/tmp', `scene-${id}-${i}.mp4`));
  const concatList     = path.join('/tmp', `concat-${id}.txt`);
  const outPath        = path.join('/tmp', `final-${id}.mp4`);
  const overlayPaths   = [];
  const toClean        = [...rawPaths, ...processedPaths, concatList, outPath];

  try {
    // 1. Download all Kling clips in parallel
    await Promise.all(videoUrls.map(async (url, i) => {
      assertAllowedUrl(url, 'apply-brand-video');
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to fetch Kling clip ${i + 1}: ${resp.status}`);
      await writeFile(rawPaths[i], Buffer.from(await resp.arrayBuffer()));
    }));

    // 2. Generate per-scene overlay PNGs sequentially (Sharp is CPU-bound)
    for (let i = 0; i < videoUrls.length; i++) {
      const scene = scenes?.[i];
      let overlayPath;
      if (i === 0) {
        // Hook scene: single punchy line from scenes[0].text — short enough to read in 5s.
        // hookText (3-line) is reserved for single_photo; too dense for a 5-second clip.
        overlayPath = await createOverlayPng(TARGET_W, TARGET_H, scene?.text ?? hookText ?? null);
      } else if (i === videoUrls.length - 1) {
        // CTA scene: reuse 3-level gradient — scene.text has 3 lines (question / keyword / offer)
        overlayPath = await createOverlayPng(TARGET_W, TARGET_H, scene?.text ?? null);
      } else {
        // Middle scenes (study, student_life): simple text pill + logo
        overlayPath = await createSimpleTextPng(TARGET_W, TARGET_H, scene?.text ?? null);
      }
      overlayPaths.push(overlayPath);
      toClean.push(overlayPath);
    }

    // 3. Process each clip: trim to SCENE_SECS + scale/crop to 9:16 + overlay
    for (let i = 0; i < rawPaths.length; i++) {
      await processClipWithOverlay(rawPaths[i], overlayPaths[i], processedPaths[i]);
    }

    // 4. Concat clips; mix in background music if a track is available
    const lines = processedPaths.map(p => `file '${p}'`).join('\n');
    await writeFile(concatList, lines);

    const musicPath = await findMusicTrack();
    const totalSecs = videoUrls.length * SCENE_SECS;

    try {
      const args = musicPath
        ? buildConcatArgsWithMusic(concatList, musicPath, totalSecs, outPath)
        : buildConcatArgsSilent(concatList, outPath);
      await execFileAsync('ffmpeg', args, { maxBuffer: 10 * 1024 * 1024 });
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

// ─── music helpers ────────────────────────────────────────────────────────────

async function findMusicTrack() {
  try {
    const files  = await readdir(MUSIC_DIR);
    const tracks = files.filter(f => /\.(mp3|m4a|aac)$/i.test(f));
    if (!tracks.length) return null;
    const pick = tracks[Math.floor(Math.random() * tracks.length)];
    console.log(`[brand-video] music track: ${pick}`);
    return path.join(MUSIC_DIR, pick);
  } catch {
    return null;
  }
}

function buildConcatArgsWithMusic(concatList, musicPath, duration, outPath) {
  return [
    '-f', 'concat', '-safe', '0', '-i', concatList,
    '-stream_loop', '-1', '-i', musicPath,
    '-map', '0:v',
    '-map', '1:a',
    '-t', String(duration),
    '-af', `volume=${MUSIC_VOLUME}`,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-y',
    outPath,
  ];
}

function buildConcatArgsSilent(concatList, outPath) {
  return [
    '-f', 'concat', '-safe', '0', '-i', concatList,
    '-c', 'copy',
    '-y',
    outPath,
  ];
}
