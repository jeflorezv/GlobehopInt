import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

const LOGO_PATH    = process.env.LOGO_PATH ?? './Logos/LOGO - GLOBEHOP SIN FONDO 2023-05.png';
const FONT_PATH    = './assets/fonts/Poppins-Bold.ttf';
const BRAND_HEX    = process.env.BRAND_PRIMARY_COLOR?.trim() || '#44539D';
const TINT_OPACITY = Math.max(0, Math.min(1, parseFloat(process.env.BRAND_TINT_OPACITY?.trim() || '0.12') || 0.12));
const BRAND_DARK   = '#1C2631';
const BRAND_MINT   = '#67BB97';

let poppinsB64 = null;
function loadFont() {
  if (!poppinsB64) poppinsB64 = readFileSync(FONT_PATH).toString('base64');
  return poppinsB64;
}

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

  // Gradient footer + Poppins hook text
  if (hookText) {
    composites.push({ input: Buffer.from(buildTextSvg(hookText, width, height)), blend: 'over' });
  }

  const logoBuf = await sharp(LOGO_PATH).trim().resize(Math.round(width * 0.42)).png().toBuffer();
  composites.push({ input: logoBuf, blend: 'over', top: 28, left: 10 });

  const filename = `branded-${randomUUID()}.jpg`;
  const tmpPath  = path.join('/tmp', filename);
  await sharp(buf).composite(composites).jpeg({ quality: 90 }).toFile(tmpPath);

  return { filename, tmpPath };
}

function buildTextSvg(text, width, height) {
  const font    = loadFont();
  const parts   = text.split('\n');
  const line1   = (parts[0] ?? text).trim();
  const line2   = (parts[1] ?? '').trim();
  const fs1     = Math.round(width * 0.052);
  const fs2     = Math.round(width * 0.068);
  const gap     = Math.round(fs1 * 0.5);
  const pad     = Math.round(fs2 * 1.1);
  const gradY   = Math.round(height * 0.58);
  const textW   = Math.round(width * 0.88);
  const accentY = height - pad - fs2 - gap - fs1 - 24;
  const y1      = height - pad - fs2 - gap;
  const y2      = height - pad;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <style>@font-face { font-family:"Poppins"; font-weight:bold; src:url("data:font/truetype;base64,${font}"); }</style>
      <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="${BRAND_DARK}" stop-opacity="0"/>
        <stop offset="50%"  stop-color="${BRAND_DARK}" stop-opacity="0.72"/>
        <stop offset="100%" stop-color="${BRAND_DARK}" stop-opacity="0.92"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${gradY}" width="${width}" height="${height - gradY}" fill="url(#grad)"/>
    <rect x="${Math.round(width*0.06)}" y="${accentY}" width="${textW}" height="3" rx="1" fill="${BRAND_MINT}"/>
    ${line1 ? `<text x="${width/2}" y="${y1}" text-anchor="middle"
      font-family="Poppins,sans-serif" font-size="${fs1}" font-weight="bold"
      fill="white" fill-opacity="0.80"
      textLength="${textW}" lengthAdjust="spacingAndGlyphs"
    >${escXml(line1)}</text>` : ''}
    ${line2 ? `<text x="${width/2}" y="${y2}" text-anchor="middle"
      font-family="Poppins,sans-serif" font-size="${fs2}" font-weight="bold"
      fill="white"
      textLength="${textW}" lengthAdjust="spacingAndGlyphs"
    >${escXml(line2)}</text>` : ''}
  </svg>`;
}

function escXml(str) {
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) throw new Error(`Invalid hex color: ${hex}`);
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
