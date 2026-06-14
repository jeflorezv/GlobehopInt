import sharp from 'sharp';
import { randomUUID } from 'crypto';
import path from 'path';

const LOGO_PATH    = path.resolve(process.env.LOGO_PATH ?? './assets/logo.png');
const FONT_PATH    = './assets/fonts/Poppins-Bold.ttf';
const BRAND_HEX    = process.env.BRAND_PRIMARY_COLOR?.trim() || '#44539D';
const TINT_OPACITY = Math.max(0, Math.min(1, parseFloat(process.env.BRAND_TINT_OPACITY?.trim() || '0.12') || 0.12));
const BRAND_DARK   = '#1C2631';
const BRAND_MINT   = '#44539D';

const FONT_ABS = path.resolve(FONT_PATH);

/**
 * Generates a transparent RGBA PNG overlay (gradient + text + logo) sized to
 * match a video frame. Intended for FFmpeg post-processing — composited AFTER
 * Kling generates the video so the AI never sees or distorts the branding.
 *
 * @param {number} width     Video frame width
 * @param {number} height    Video frame height
 * @param {string|null} hookText  Two-line hook string (lines separated by \n)
 * @returns {Promise<string>} Absolute path to the PNG file in /tmp
 */
export async function createOverlayPng(width, height, hookText = null) {
  const composites = [];

  for (const layer of await buildTextOverlay(hookText || null, width, height, true)) {
    composites.push(layer);
  }

  const logoBuf = await sharp(LOGO_PATH).trim().resize(Math.round(width * 0.28)).png().toBuffer();
  composites.push({ input: logoBuf, blend: 'over', top: 75, left: 24 });

  const filename = `overlay-${randomUUID()}.png`;
  const tmpPath  = path.join('/tmp', filename);

  await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toFile(tmpPath);

  return tmpPath;
}

export async function applyBrand(imageUrl, hookText = null, isReel = false) {
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status} ${imageUrl}`);
  const buf = Buffer.from(await resp.arrayBuffer());

  const { width, height } = await sharp(buf).metadata();
  const composites = [];

  const { r, g, b } = hexToRgb(BRAND_HEX);
  const tintBuf = await sharp({
    create: { width, height, channels: 4, background: { r, g, b, alpha: TINT_OPACITY } },
  }).png().toBuffer();
  composites.push({ input: tintBuf, blend: 'over' });

  for (const layer of await buildTextOverlay(hookText || null, width, height, isReel)) {
    composites.push(layer);
  }

  const logoBuf = await sharp(LOGO_PATH).trim().resize(Math.round(width * 0.28)).png().toBuffer();
  composites.push({ input: logoBuf, blend: 'over', top: 75, left: 24 });

  const compositedBuf = await sharp(buf).composite(composites).png().toBuffer();

  const filename = `branded-${randomUUID()}.jpg`;
  const tmpPath  = path.join('/tmp', filename);

  if (isReel) {
    // Keep native 9:16 — Kling inherits the input image dimensions
    await sharp(compositedBuf)
      .jpeg({ quality: 90 })
      .toFile(tmpPath);
  } else {
    // Crop 3:4 → 4:5 (Instagram feed standard)
    const cropTop    = Math.round((height - Math.round(width * 5 / 4)) / 2);
    const cropHeight = height - cropTop * 2;
    await sharp(compositedBuf)
      .extract({ left: 0, top: cropTop, width, height: cropHeight })
      .jpeg({ quality: 90 })
      .toFile(tmpPath);
  }

  return { filename, tmpPath };
}

// ─── overlay ──────────────────────────────────────────────────────────────────

async function buildTextOverlay(text, imgW, imgH, isReel = false) {
  const parts    = text ? text.split('\n') : [];
  const lineMain = (parts[0] ?? '').trim(); // Transformation hook — largest
  const lineCta  = (parts[1] ?? '').trim(); // CTA                — medium

  const fsMain  = Math.round(imgW * 0.068);
  const fsCta   = Math.round(imgW * 0.042);
  const gap     = Math.round(fsMain * 0.38);
  // Reels: raise text 240px extra so Kling's push-in zoom doesn't push it off the bottom edge.
  // Single photos: 120px clears Instagram's feed UI overlay.
  const pad     = Math.round(imgW / 24) + (isReel ? 240 : 120);
  const textW   = Math.round(imgW * 0.88);
  // Reels have a taller canvas and vivid backgrounds — start gradient higher and go darker
  // so white text is always legible regardless of what Kling/Ideogram puts behind it.
  const gradY      = Math.round(imgH * (isReel ? 0.38 : 0.52));
  const gradMaxOpa = isReel ? 0.88 : 0.68;

  const layers  = [];
  let cursorY   = imgH - pad; // tracks next available bottom edge, moving upward

  const gradSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${BRAND_DARK}" stop-opacity="0"/>
        <stop offset="50%"  stop-color="${BRAND_DARK}" stop-opacity="${(gradMaxOpa * 0.6).toFixed(2)}"/>
        <stop offset="100%" stop-color="${BRAND_DARK}" stop-opacity="${gradMaxOpa}"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${gradY}" width="${imgW}" height="${imgH - gradY}" fill="url(#g)"/>
  </svg>`;
  layers.push({ input: Buffer.from(gradSvg), blend: 'over' });

  const renderLine = async (lineText, fontSize, opacity = 1, wrap = 'none') => {
    const alpha  = Math.round(opacity * 255).toString(16).padStart(2, '0').toUpperCase();
    const colour = `#FFFFFF${alpha}`;
    return sharp({
      text: {
        text:     `<span foreground="${colour}">${escPango(lineText)}</span>`,
        fontfile: FONT_ABS,
        font:     `Poppins Bold ${fontSize}`,
        rgba:     true,
        align:    'centre',
        width:    textW,
        wrap,
        dpi:      72,
      },
    }).png().toBuffer();
  };

  // Bottom to top: CTA → main → accent bar

  if (lineCta) {
    const buf = await renderLine(lineCta, fsCta, 1.0);
    const { width: bw, height: bh } = await sharp(buf).metadata();
    layers.push({ input: buf, blend: 'over', top: cursorY - bh, left: Math.round((imgW - bw) / 2) });
    cursorY -= bh + gap;
  }

  if (lineMain) {
    const buf = await renderLine(lineMain, fsMain, 1.0, 'word');
    const { width: bw, height: bh } = await sharp(buf).metadata();
    layers.push({ input: buf, blend: 'over', top: cursorY - bh, left: Math.round((imgW - bw) / 2) });
    cursorY -= bh + 16;
  }

  // Mint accent bar above the text block
  if (lineMain) {
    const barSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}">
      <rect x="${Math.round(imgW * 0.06)}" y="${cursorY}" width="${textW}" height="3" rx="1" fill="${BRAND_MINT}"/>
    </svg>`;
    layers.push({ input: Buffer.from(barSvg), blend: 'over' });
  }

  return layers;
}

function escPango(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) throw new Error(`Invalid hex color: ${hex}`);
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
