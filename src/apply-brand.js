import sharp from 'sharp';
import { randomUUID } from 'crypto';
import path from 'path';

const LOGO_PATH    = process.env.LOGO_PATH ?? './Logos/LOGO - GLOBEHOP SIN FONDO 2023-05.png';
const FONT_PATH    = './assets/fonts/Poppins-Bold.ttf';
const BRAND_HEX    = process.env.BRAND_PRIMARY_COLOR?.trim() || '#44539D';
const TINT_OPACITY = Math.max(0, Math.min(1, parseFloat(process.env.BRAND_TINT_OPACITY?.trim() || '0.12') || 0.12));
const BRAND_DARK   = '#1C2631';
const BRAND_MINT   = '#67BB97';

// Absolute font path — required by Sharp text input on Railway
const FONT_ABS = path.resolve(FONT_PATH);

export async function applyBrand(imageUrl, hookText = null) {
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status} ${imageUrl}`);
  const buf = Buffer.from(await resp.arrayBuffer());

  const { width, height } = await sharp(buf).metadata();
  const composites = [];

  // Subtle brand colour tint
  const { r, g, b } = hexToRgb(BRAND_HEX);
  const tintBuf = await sharp({
    create: { width, height, channels: 4, background: { r, g, b, alpha: TINT_OPACITY } },
  }).png().toBuffer();
  composites.push({ input: tintBuf, blend: 'over' });

  // Gradient footer always; Poppins hook text when provided
  for (const layer of await buildTextOverlay(hookText || null, width, height)) {
    composites.push(layer);
  }

  const logoBuf = await sharp(LOGO_PATH).trim().resize(Math.round(width * 0.42)).png().toBuffer();
  composites.push({ input: logoBuf, blend: 'over', top: 28, left: 10 });

  const filename = `branded-${randomUUID()}.jpg`;
  const tmpPath  = path.join('/tmp', filename);
  await sharp(buf).composite(composites).jpeg({ quality: 90 }).toFile(tmpPath);

  return { filename, tmpPath };
}

async function buildTextOverlay(text, imgW, imgH) {
  const parts   = text ? text.split('\n') : [];
  const line1   = (parts[0] ?? '').trim();
  const line2   = (parts[1] ?? '').trim();
  const fs1     = Math.round(imgW * 0.052);
  const fs2     = Math.round(imgW * 0.068);
  const gap     = Math.round(fs1 * 0.5);
  const pad     = Math.round(fs2 * 1.1);
  const gradY   = Math.round(imgH * 0.58);
  const textW   = Math.round(imgW * 0.88);
  const accentY = imgH - pad - fs2 - gap - fs1 - 24;

  const layers = [];

  // Gradient footer + accent bar via SVG (no font needed — librsvg handles these fine)
  const gradSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${BRAND_DARK}" stop-opacity="0"/>
        <stop offset="50%"  stop-color="${BRAND_DARK}" stop-opacity="0.72"/>
        <stop offset="100%" stop-color="${BRAND_DARK}" stop-opacity="0.92"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${gradY}" width="${imgW}" height="${imgH - gradY}" fill="url(#g)"/>
    <rect x="${Math.round(imgW * 0.06)}" y="${accentY}" width="${textW}" height="3" rx="1" fill="${BRAND_MINT}"/>
  </svg>`;
  layers.push({ input: Buffer.from(gradSvg), blend: 'over' });

  // Text rendered via Sharp's native text input (libvips/Pango honours the .ttf file)
  const renderLine = async (lineText, fontSize, opacity = 1) => {
    const alpha  = Math.round(opacity * 255).toString(16).padStart(2, '0').toUpperCase();
    const colour = `#FFFFFF${alpha}`;
    const buf = await sharp({
      text: {
        text:     `<span foreground="${colour}">${escPango(lineText)}</span>`,
        fontfile: FONT_ABS,
        font:     `Poppins Bold ${fontSize}`,
        rgba:     true,
        align:    'centre',
        width:    textW,
        wrap:     'none',
        dpi:      72,
      },
    }).png().toBuffer();
    return buf;
  };

  if (line2) {
    const buf = await renderLine(line2, fs2, 1.0);
    const { width: bw, height: bh } = await sharp(buf).metadata();
    layers.push({ input: buf, blend: 'over', top: imgH - pad - bh, left: Math.round((imgW - bw) / 2) });
  }

  if (line1) {
    const buf = await renderLine(line1, fs1, 0.8);
    const { width: bw, height: bh } = await sharp(buf).metadata();
    layers.push({ input: buf, blend: 'over', top: imgH - pad - fs2 - gap - bh, left: Math.round((imgW - bw) / 2) });
  }

  return layers;
}

function escPango(str) {
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) throw new Error(`Invalid hex color: ${hex}`);
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
