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
 * @param {string|null} hookText  Hook string with 2–3 lines separated by \n (headline / body / CTA)
 * @returns {Promise<string>} Absolute path to the PNG file in /tmp
 */
export async function createOverlayPng(width, height, hookText = null) {
  const composites = [];

  for (const layer of await buildTextOverlay(hookText || null, width, height, true)) {
    composites.push(layer);
  }

  const logoBuf = await sharp(LOGO_PATH).trim().resize(Math.round(width * 0.22)).png().toBuffer();
  const { width: lw, height: lh } = await sharp(logoBuf).metadata();
  const logoPad = 18;
  const logoBgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="${24 - logoPad}" y="${56 - logoPad}" width="${lw + logoPad * 2}" height="${lh + logoPad * 2}" rx="12" fill="${BRAND_DARK}" fill-opacity="0.60"/>
  </svg>`;
  composites.push({ input: Buffer.from(logoBgSvg), blend: 'over' });
  composites.push({ input: logoBuf, blend: 'over', top: 56, left: 24 });

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
  const hasThree = parts.length >= 3;

  // 3-level hierarchy (new format): headline / body / CTA
  // 2-level fallback (legacy): headline / CTA
  const lineHeadline = (parts[0] ?? '').trim();
  const lineBody     = hasThree ? (parts[1] ?? '').trim() : '';
  const lineCta      = hasThree ? (parts[2] ?? '').trim() : (parts[1] ?? '').trim();

  const fsHeadline = Math.round(imgW * 0.082);
  const fsBody     = Math.round(imgW * 0.050);
  const fsCta      = Math.round(imgW * 0.042);
  const gap        = Math.round(fsHeadline * 0.32);
  const pad        = Math.round(imgW / 24) + (isReel ? 240 : 120);
  const textW      = Math.round(imgW * 0.88);
  const gradY      = Math.round(imgH * (isReel ? 0.35 : 0.52));
  const gradMaxOpa = isReel ? 0.92 : 0.68;

  const layers = [];
  let cursorY  = imgH - pad;

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

  // Build bottom → top: CTA pill → body → headline → accent bar

  if (lineCta) {
    const buf = await renderLine(lineCta, fsCta, 1.0);
    const { width: bw, height: bh } = await sharp(buf).metadata();
    const pillPadX = 36;
    const pillPadY = 14;
    const pillW    = bw + pillPadX * 2;
    const pillH    = bh + pillPadY * 2;
    const pillLeft = Math.round((imgW - pillW) / 2);
    const pillTop  = cursorY - pillH;
    const pillSvg  = `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}">
      <rect x="${pillLeft}" y="${pillTop}" width="${pillW}" height="${pillH}" rx="${Math.round(pillH / 2)}" fill="${BRAND_MINT}" fill-opacity="0.92"/>
    </svg>`;
    layers.push({ input: Buffer.from(pillSvg), blend: 'over' });
    layers.push({ input: buf, blend: 'over', top: pillTop + pillPadY, left: Math.round((imgW - bw) / 2) });
    cursorY = pillTop - gap;
  }

  if (lineBody) {
    const buf = await renderLine(lineBody, fsBody, 0.88, 'word');
    const { width: bw, height: bh } = await sharp(buf).metadata();
    layers.push({ input: buf, blend: 'over', top: cursorY - bh, left: Math.round((imgW - bw) / 2) });
    cursorY -= bh + Math.round(gap * 0.6);
  }

  if (lineHeadline) {
    const buf = await renderLine(lineHeadline, fsHeadline, 1.0, 'word');
    const { width: bw, height: bh } = await sharp(buf).metadata();
    layers.push({ input: buf, blend: 'over', top: cursorY - bh, left: Math.round((imgW - bw) / 2) });
    cursorY -= bh + 16;
  }

  if (lineHeadline) {
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
