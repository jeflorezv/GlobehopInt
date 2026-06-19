import sharp from 'sharp';
import { randomUUID } from 'crypto';
import path from 'path';

const LOGO_PATH    = path.resolve(process.env.LOGO_PATH ?? './assets/logo.png');
const ICON_PATH    = path.resolve(process.env.ICON_PATH ?? './assets/icon-no-bg.png');
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

  const iconBuf = await sharp(ICON_PATH).trim().resize(Math.round(width * 0.14)).png().toBuffer();
  const { width: iw, height: ih } = await sharp(iconBuf).metadata();
  const iconPad = 10;
  const iconBgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="${20 - iconPad}" y="${48 - iconPad}" width="${iw + iconPad * 2}" height="${ih + iconPad * 2}" rx="${Math.round((ih + iconPad * 2) / 2)}" fill="${BRAND_DARK}" fill-opacity="0.42"/>
  </svg>`;
  composites.push({ input: Buffer.from(iconBgSvg), blend: 'over' });
  composites.push({ input: iconBuf, blend: 'over', top: 48, left: 20 });

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

// ─── shared helpers ───────────────────────────────────────────────────────────

function stripEmoji(text) {
  return text
    .replace(/[\u{1F1E0}-\u{1F1FF}]{2}/gu, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/️/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function renderTextLine(text, fontSize, maxWidth, opacity = 1.0, wrap = 'word') {
  const cleaned = stripEmoji(text);
  const alpha  = Math.round(opacity * 255).toString(16).padStart(2, '0').toUpperCase();
  return sharp({
    text: {
      text:     `<span foreground="#FFFFFF${alpha}">${escPango(cleaned)}</span>`,
      fontfile: FONT_ABS,
      font:     `Poppins Bold ${fontSize}`,
      rgba:     true,
      align:    'centre',
      width:    maxWidth,
      wrap,
      dpi:      72,
    },
  }).png().toBuffer();
}

// ─── end card ─────────────────────────────────────────────────────────────────

/**
 * Generates a solid-background branded end card PNG for the 4-scene reel.
 * Centred logo + tagline + CTA pill. Used as the final 2-second scene.
 *
 * @param {number} width
 * @param {number} height
 * @param {string|null} ctaText  CTA line from the hook (line 3), e.g. "Escribe «IRLANDA»"
 * @returns {Promise<string>} Absolute path to the PNG in /tmp
 */
export async function createEndCardPng(width, height, ctaText = null) {
  const composites = [];

  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="0" y="0" width="${width}" height="${height}" fill="${BRAND_DARK}"/>
  </svg>`;
  composites.push({ input: Buffer.from(bgSvg), blend: 'over' });

  const logoSize = Math.round(width * 0.55);
  const logoBuf  = await sharp(LOGO_PATH).trim().resize(logoSize).png().toBuffer();
  const { width: lw, height: lh } = await sharp(logoBuf).metadata();
  const logoTop  = Math.round(height * 0.28);
  composites.push({ input: logoBuf, blend: 'over', top: logoTop, left: Math.round((width - lw) / 2) });

  const taglineY   = logoTop + lh + 44;
  const fsTagline  = Math.round(width * 0.042);
  const taglineBuf = await renderTextLine('Tu futuro empieza aquí', fsTagline, Math.round(width * 0.80), 0.65);
  const { width: tw, height: th } = await sharp(taglineBuf).metadata();
  composites.push({ input: taglineBuf, blend: 'over', top: taglineY, left: Math.round((width - tw) / 2) });

  const barY = taglineY + th + 36;
  const barW = Math.round(width * 0.30);
  const barSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="${Math.round((width - barW) / 2)}" y="${barY}" width="${barW}" height="2" rx="1" fill="${BRAND_MINT}"/>
  </svg>`;
  composites.push({ input: Buffer.from(barSvg), blend: 'over' });

  if (ctaText) {
    const fsCta      = Math.round(width * 0.052);
    const ctaBuf     = await renderTextLine(ctaText, fsCta, Math.round(width * 0.80), 1.0);
    const { width: cw, height: ch } = await sharp(ctaBuf).metadata();
    const pillPadX   = 40;
    const pillPadY   = 16;
    const pillW      = cw + pillPadX * 2;
    const pillH      = ch + pillPadY * 2;
    const pillLeft   = Math.round((width - pillW) / 2);
    const ctaTop     = barY + 40;
    const pillSvg    = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="${pillLeft}" y="${ctaTop}" width="${pillW}" height="${pillH}" rx="${Math.round(pillH / 2)}" fill="${BRAND_MINT}" fill-opacity="0.92"/>
    </svg>`;
    composites.push({ input: Buffer.from(pillSvg), blend: 'over' });
    composites.push({ input: ctaBuf, blend: 'over', top: ctaTop + pillPadY, left: Math.round((width - cw) / 2) });
  }

  const filename = `endcard-${randomUUID()}.png`;
  const tmpPath  = path.join('/tmp', filename);

  await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toFile(tmpPath);

  return tmpPath;
}

// ─── simple scene text overlay ───────────────────────────────────────────────

/**
 * Generates a transparent overlay PNG with a simple text pill for middle reel
 * scenes (study, student_life). Includes the logo for brand consistency.
 *
 * @param {number} width
 * @param {number} height
 * @param {string|null} text  Short text, up to 2 lines separated by \n
 * @returns {Promise<string>} Absolute path to the PNG in /tmp
 */
export async function createSimpleTextPng(width, height, text = null) {
  const composites = [];

  if (text) {
    const lines    = text.split('\n').filter(Boolean);
    const fontSize = Math.round(width * 0.058);
    const textW    = Math.round(width * 0.84);
    const lineGap  = 10;
    const pillPadX = 32;
    const pillPadY = 14;

    const rendered = await Promise.all(lines.map(l => renderTextLine(l, fontSize, textW, 1.0)));
    const sizes    = await Promise.all(rendered.map(buf => sharp(buf).metadata()));

    const totalH  = sizes.reduce((sum, s) => sum + s.height, 0) + lineGap * (lines.length - 1);
    const pillW   = Math.max(...sizes.map(s => s.width)) + pillPadX * 2;
    const pillH   = totalH + pillPadY * 2;
    const pillTop = height - Math.round(height * 0.09) - pillH;
    const pillLeft = Math.round((width - pillW) / 2);

    const softGradY = Math.round(height * 0.65);
    const gradSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="${BRAND_DARK}" stop-opacity="0"/>
          <stop offset="100%" stop-color="${BRAND_DARK}" stop-opacity="0.70"/>
        </linearGradient>
      </defs>
      <rect x="0" y="${softGradY}" width="${width}" height="${height - softGradY}" fill="url(#g)"/>
    </svg>`;
    composites.push({ input: Buffer.from(gradSvg), blend: 'over' });

    const pillSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="${pillLeft}" y="${pillTop}" width="${pillW}" height="${pillH}" rx="12" fill="${BRAND_DARK}" fill-opacity="0.72"/>
    </svg>`;
    composites.push({ input: Buffer.from(pillSvg), blend: 'over' });

    let lineY = pillTop + pillPadY;
    for (let i = 0; i < rendered.length; i++) {
      composites.push({ input: rendered[i], blend: 'over', top: lineY, left: Math.round((width - sizes[i].width) / 2) });
      lineY += sizes[i].height + lineGap;
    }
  }

  const iconBuf = await sharp(ICON_PATH).trim().resize(Math.round(width * 0.14)).png().toBuffer();
  const { width: iw, height: ih } = await sharp(iconBuf).metadata();
  const iconPad = 10;
  const iconBgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="${20 - iconPad}" y="${48 - iconPad}" width="${iw + iconPad * 2}" height="${ih + iconPad * 2}" rx="${Math.round((ih + iconPad * 2) / 2)}" fill="${BRAND_DARK}" fill-opacity="0.42"/>
  </svg>`;
  composites.push({ input: Buffer.from(iconBgSvg), blend: 'over' });
  composites.push({ input: iconBuf, blend: 'over', top: 48, left: 20 });

  const filename = `scene-text-${randomUUID()}.png`;
  const tmpPath  = path.join('/tmp', filename);

  await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toFile(tmpPath);

  return tmpPath;
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

  const fsHeadline = Math.round(imgW * 0.065);
  const fsBody     = Math.round(imgW * 0.050);
  const fsCta      = Math.round(imgW * 0.042);
  const gap        = Math.round(fsHeadline * 0.32);
  const pad        = Math.round(imgW / 24) + (isReel ? 200 : 120);
  const textW      = Math.round(imgW * 0.88);
  const gradY      = Math.round(imgH * (isReel ? 0.58 : 0.52));
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

  // Build bottom → top: CTA pill → body → headline → accent bar

  if (lineCta) {
    const buf = await renderTextLine(lineCta, fsCta, textW, 1.0, 'none');
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
    const buf = await renderTextLine(lineBody, fsBody, textW, 0.88);
    const { width: bw, height: bh } = await sharp(buf).metadata();
    layers.push({ input: buf, blend: 'over', top: cursorY - bh, left: Math.round((imgW - bw) / 2) });
    cursorY -= bh + Math.round(gap * 0.6);
  }

  if (lineHeadline) {
    const buf = await renderTextLine(lineHeadline, fsHeadline, textW, 1.0);
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
