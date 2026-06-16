import puppeteer from 'puppeteer';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadToCdn } from './upload-cdn.js';
import { withRetry } from './utils/retry.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const ASSETS       = path.resolve(__dirname, '../assets');
const FONTS_DIR    = path.join(ASSETS, 'fonts');
const IDEOGRAM_URL = 'https://api.ideogram.ai/generate';

// Loaded once at startup and cached for all render calls.
const [NEXA_HEAVY, NEXA_LIGHT, POPPINS_BOLD, LOGO_B64, ICON_B64] = await Promise.all([
  readFile(path.join(FONTS_DIR, 'Nexa-Heavy.ttf')).then(b => b.toString('base64')),
  readFile(path.join(FONTS_DIR, 'Nexa-ExtraLight.ttf')).then(b => b.toString('base64')),
  readFile(path.join(FONTS_DIR, 'Poppins-Bold.ttf')).then(b => b.toString('base64')),
  readFile(path.join(ASSETS, 'logo-no-bg.png')).then(b => b.toString('base64')),
  readFile(path.join(ASSETS, 'icon-no-bg.png')).then(b => b.toString('base64')),
]);

const C = {
  DARK_BLUE: '#1C2631',
  BLUE:      '#44539D',
  MINT:      '#67BB97',
  WHITE:     '#FFFFFF',
};

export async function renderCarousel(record, ctx) {
  const slides = [...(ctx.slides ?? [])].sort((a, b) => a.slideNumber - b.slideNumber);
  if (!slides.length) throw new Error('[render-carousel] ctx.slides is empty');

  const dest = record['Destino/Tema'] ?? 'Ireland';

  // Generate all background images in parallel before opening the browser
  console.log('[render-carousel] generating background images in parallel...');
  const bgImages = await Promise.all(
    slides.map(slide =>
      generateBackground(slide.imagePrompt ?? defaultPrompt(dest, slide.slideNumber))
    )
  );

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });

    const rendered = [];
    for (let i = 0; i < slides.length; i++) {
      const slide   = slides[i];
      const bgB64   = bgImages[i];
      const html    = buildSlideHtml(slide, slides.length, bgB64);

      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluateHandle('document.fonts.ready');

      const buf = await page.screenshot({ type: 'png' });
      const tmp = `/tmp/gh-c-${Date.now()}-s${slide.slideNumber}.png`;
      await writeFile(tmp, buf);

      const url = await uploadToCdn(tmp, path.basename(tmp));
      await unlink(tmp).catch(() => {});

      console.log(`[render-carousel] slide ${slide.slideNumber}/${slides.length} → ${url}`);
      rendered.push({ ...slide, imageUrl: url });
    }

    return { ...ctx, slides: rendered };
  } finally {
    await browser.close();
  }
}

// ─── background image generation ─────────────────────────────────────────────

async function generateBackground(prompt) {
  return withRetry(async () => {
    const resp = await fetch(IDEOGRAM_URL, {
      method:  'POST',
      headers: { 'Api-Key': process.env.IDEOGRAM_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_request: {
          prompt,
          aspect_ratio:        'ASPECT_1_1',
          model:               'V_2',
          style_type:          'REALISTIC',
          magic_prompt_option: 'OFF',
        },
      }),
    });

    if (!resp.ok) {
      const t   = await resp.text();
      const err = new Error(`Ideogram ${resp.status}: ${t}`);
      err.status = resp.status;
      throw err;
    }

    const json = await resp.json();
    const imgUrl = json?.data?.[0]?.url;
    if (!imgUrl) throw new Error(`[render-carousel] Ideogram: no URL in response`);

    const imgResp = await fetch(imgUrl);
    const buf     = Buffer.from(await imgResp.arrayBuffer());
    return buf.toString('base64');
  });
}

function defaultPrompt(dest, slideNumber) {
  if (slideNumber === 6) {
    return `Young happy student standing triumphantly in front of iconic landmark in ${dest}, arms raised, warm golden light, aspirational travel photography, photorealistic, editorial quality, no text`;
  }
  return `Stunning wide-angle photograph of ${dest} cityscape, dramatic natural light, architectural detail, travel photography, photorealistic, editorial quality, no text or logos`;
}

// ─── Puppeteer helpers ────────────────────────────────────────────────────────

function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none',
    ],
  });
}

function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── shared CSS ───────────────────────────────────────────────────────────────

function fonts() {
  return `
    @font-face { font-family:'Nexa'; font-weight:900;
      src:url('data:font/truetype;base64,${NEXA_HEAVY}') format('truetype'); }
    @font-face { font-family:'Nexa'; font-weight:200;
      src:url('data:font/truetype;base64,${NEXA_LIGHT}') format('truetype'); }
    @font-face { font-family:'Poppins'; font-weight:700;
      src:url('data:font/truetype;base64,${POPPINS_BOLD}') format('truetype'); }
    * { margin:0; padding:0; box-sizing:border-box; }
  `;
}

function logoPill(size = 199) {
  return `<img src="data:image/png;base64,${ICON_B64}"
    style="width:${size}px;height:${size}px;display:block;object-fit:contain;
    filter:drop-shadow(0 2px 8px rgba(0,0,0,0.85));"
    alt="GlobeHop">`;
}

function chip(n, total) {
  return `
    <div style="
      background:rgba(255,255,255,0.20); border-radius:30px;
      padding:8px 22px; color:${C.WHITE};
      font-family:'Poppins',sans-serif; font-weight:700;
      font-size:22px; letter-spacing:1px; white-space:nowrap;
      backdrop-filter:blur(4px);
    ">${n} / ${total}</div>`;
}

// Full-slide background + gradient overlay
function bgStyle(b64, overlayColor = 'rgba(18,26,36,0.72)') {
  return `
    background-image: url('data:image/jpeg;base64,${b64}');
    background-size: cover;
    background-position: center;
  `;
}

function overlay(color = 'rgba(18,26,36,0.48)') {
  return `
    <div style="
      position:absolute; inset:0;
      background:${color};
    "></div>`;
}

// ─── slide layouts ────────────────────────────────────────────────────────────

function buildSlideHtml(slide, total, bgB64) {
  switch (slide.layout) {
    case 'hook':      return hookHtml(slide, total, bgB64);
    case 'statement': return statementHtml(slide, total, bgB64);
    case 'list':      return listHtml(slide, total, bgB64);
    case 'fact':      return factHtml(slide, total, bgB64);
    case 'cta':       return ctaHtml(slide, total, bgB64);
    default:          return statementHtml(slide, total, bgB64);
  }
}

function hookHtml(s, total, bgB64) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>
  ${fonts()}
  body {
    width:1080px; height:1080px; overflow:hidden;
    position:relative; display:flex; flex-direction:column;
    ${bgStyle(bgB64)}
  }
  .layer { position:relative; z-index:1; display:flex; flex-direction:column; height:100%; }
  .top  { display:flex; justify-content:space-between; align-items:flex-start; padding:44px 44px 0; }
  .content {
    flex:1; display:flex; flex-direction:column;
    justify-content:flex-end; padding:0 64px 90px;
  }
  .headline {
    font-family:'Nexa',sans-serif; font-weight:900;
    font-size:82px; line-height:1.06; color:${C.WHITE};
    letter-spacing:-1px; word-break:break-word;
    text-shadow: 0 2px 20px rgba(0,0,0,0.5);
  }
  .subtext {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:28px; color:rgba(255,255,255,0.85);
    margin-top:20px; line-height:1.4;
    text-shadow: 0 1px 10px rgba(0,0,0,0.6);
  }
  .swipe {
    display:flex; justify-content:flex-end; padding:0 64px 18px;
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:20px; color:${C.MINT}; letter-spacing:0.5px; position:relative; z-index:1;
  }
  .bar { height:8px; background:${C.MINT}; flex-shrink:0; position:relative; z-index:1; }
</style></head><body>
  ${overlay()}
  <div class="layer">
    <div class="top">${logoPill()} ${chip(s.slideNumber, total)}</div>
    <div class="content">
      <div class="headline">${esc(s.headline)}</div>
      ${s.subtext ? `<div class="subtext">${esc(s.subtext)}</div>` : ''}
    </div>
  </div>
  <div class="swipe">Desliza para más →</div>
  <div class="bar"></div>
</body></html>`;
}

function statementHtml(s, total, bgB64) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>
  ${fonts()}
  body {
    width:1080px; height:1080px; overflow:hidden;
    position:relative; display:flex; flex-direction:column;
    ${bgStyle(bgB64)}
  }
  .layer { position:relative; z-index:1; display:flex; flex-direction:column; height:100%; }
  .top   { display:flex; justify-content:space-between; align-items:flex-start; padding:44px 44px 0; }
  .content {
    flex:1; display:flex; flex-direction:column;
    justify-content:flex-end; align-items:center; text-align:center;
    padding:0 76px 90px;
  }
  .headline {
    font-family:'Nexa',sans-serif; font-weight:900;
    font-size:74px; line-height:1.08; color:${C.WHITE};
    word-break:break-word;
    text-shadow: 0 2px 20px rgba(0,0,0,0.6);
  }
  .body {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:28px; color:rgba(255,255,255,0.88);
    margin-top:32px; line-height:1.5;
    text-shadow: 0 1px 10px rgba(0,0,0,0.5);
  }
  .accent { width:72px; height:5px; background:${C.MINT}; border-radius:3px; margin-top:44px; }
  .bar    { height:8px; background:${C.MINT}; flex-shrink:0; position:relative; z-index:1; }
</style></head><body>
  ${overlay('rgba(18,26,36,0.46)')}
  <div class="layer">
    <div class="top">${logoPill()} ${chip(s.slideNumber, total)}</div>
    <div class="content">
      ${s.tag ? `<div style="
        display:inline-block;background:${C.MINT};border-radius:6px;
        padding:5px 14px;margin-bottom:22px;
        font-family:'Poppins',sans-serif;font-weight:700;
        font-size:17px;color:${C.WHITE};letter-spacing:2px;text-transform:uppercase;
      ">${esc(s.tag)}</div>` : ''}
      <div class="headline">${esc(s.headline)}</div>
      ${s.body ? `<div class="body">${esc(s.body)}</div>` : ''}
      <div class="accent"></div>
    </div>
  </div>
  <div class="bar"></div>
</body></html>`;
}

function listHtml(s, total, bgB64) {
  const items = (s.items ?? []).slice(0, 4);
  const rows  = items.map(item => {
    const raw       = String(item ?? '');
    const isMistake = raw.startsWith('✖') || raw.startsWith('✗') || raw.startsWith('✘');
    const isCheck   = raw.startsWith('✓') || raw.startsWith('✔');
    const text      = (isMistake || isCheck) ? raw.slice(1).trim() : raw;
    const bg        = isMistake ? '#CF202C' : C.MINT;
    const icon      = isMistake
      ? `<path d="M5 5L15 15M15 5L5 15" stroke="white" stroke-width="2.5" stroke-linecap="round"/>`
      : `<path d="M2 9L7 14L18 3" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    return `
    <div style="display:flex;align-items:center;margin-bottom:30px;">
      <div style="
        min-width:48px; height:48px; border-radius:50%;
        background:${bg};
        display:flex; align-items:center; justify-content:center;
        margin-right:22px; flex-shrink:0;
      ">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">${icon}</svg>
      </div>
      <span style="
        font-family:'Poppins',sans-serif; font-weight:700;
        font-size:32px; color:${C.WHITE}; line-height:1.2;
        text-shadow: 0 1px 8px rgba(0,0,0,0.5);
      ">${esc(text)}</span>
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>
  ${fonts()}
  body {
    width:1080px; height:1080px; overflow:hidden;
    position:relative; display:flex; flex-direction:column;
    ${bgStyle(bgB64)}
  }
  .layer { position:relative; z-index:1; display:flex; flex-direction:column; height:100%; }
  .top   { display:flex; justify-content:space-between; align-items:flex-start; padding:44px 44px 0; }
  .content { flex:1; display:flex; flex-direction:column; justify-content:flex-end; padding:0 64px 80px; }
  .headline {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:44px; color:${C.WHITE};
    line-height:1.2; word-break:break-word;
    text-shadow: 0 2px 16px rgba(0,0,0,0.6);
  }
  .rule  { width:90px; height:5px; background:${C.MINT}; border-radius:3px; margin:20px 0 40px; }
  .bar   { height:8px; background:${C.MINT}; flex-shrink:0; position:relative; z-index:1; }
</style></head><body>
  ${overlay('rgba(18,26,36,0.52)')}
  <div class="layer">
    <div class="top">${logoPill()} ${chip(s.slideNumber, total)}</div>
    <div class="content">
      <div class="headline">${esc(s.headline)}</div>
      <div class="rule"></div>
      <div>${rows}</div>
    </div>
  </div>
  <div class="bar"></div>
</body></html>`;
}

function factHtml(s, total, bgB64) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>
  ${fonts()}
  body {
    width:1080px; height:1080px; overflow:hidden;
    position:relative; display:flex; flex-direction:column;
    ${bgStyle(bgB64)}
  }
  .layer { position:relative; z-index:1; display:flex; flex-direction:column; height:100%; }
  .top   { display:flex; justify-content:space-between; align-items:flex-start; padding:44px 44px 0; }
  .content { flex:1; display:flex; flex-direction:column; justify-content:flex-end; padding:0 80px 80px; }
  .headline {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:34px; color:rgba(255,255,255,0.88);
    margin-bottom:32px; line-height:1.2;
    text-shadow: 0 1px 10px rgba(0,0,0,0.5);
  }
  .stat {
    font-family:'Nexa',sans-serif; font-weight:900;
    font-size:130px; color:${C.MINT};
    line-height:1; letter-spacing:-3px;
    text-shadow: 0 2px 24px rgba(0,0,0,0.4);
  }
  .stat-label {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:24px; color:${C.WHITE};
    text-transform:uppercase; letter-spacing:3px;
    margin-top:10px; margin-bottom:28px;
    opacity:0.85;
  }
  .body {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:27px; color:rgba(255,255,255,0.80); line-height:1.5;
    text-shadow: 0 1px 8px rgba(0,0,0,0.4);
  }
  .bar { height:8px; background:${C.MINT}; flex-shrink:0; position:relative; z-index:1; }
</style></head><body>
  ${overlay('rgba(18,26,36,0.50)')}
  <div class="layer">
    <div class="top">${logoPill()} ${chip(s.slideNumber, total)}</div>
    <div class="content">
      ${s.headline ? `<div class="headline">${esc(s.headline)}</div>` : ''}
      <div class="stat">${esc(s.stat)}</div>
      <div class="stat-label">${esc(s.statLabel)}</div>
      ${s.body ? `<div class="body">${esc(s.body)}</div>` : ''}
    </div>
  </div>
  <div class="bar"></div>
</body></html>`;
}

function ctaHtml(s, total, bgB64) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>
  ${fonts()}
  body {
    width:1080px; height:1080px; overflow:hidden;
    position:relative; display:flex; flex-direction:column;
    ${bgStyle(bgB64)}
  }
  .top  { position:relative; z-index:1; display:flex; justify-content:space-between; align-items:flex-start; padding:44px 44px 0; }
  .layer {
    position:relative; z-index:1; flex:1;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    text-align:center; padding:0 60px;
  }
  .divider { width:64px; height:4px; background:${C.MINT}; border-radius:2px; margin:0 auto 48px; }
  .headline {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:30px; color:rgba(255,255,255,0.85);
    margin-bottom:28px; line-height:1.35;
    text-shadow: 0 1px 10px rgba(0,0,0,0.5);
  }
  .kw {
    font-family:'Nexa',sans-serif; font-weight:900;
    font-size:96px; color:${C.WHITE};
    line-height:1; letter-spacing:-1px; margin-bottom:24px;
    text-shadow: 0 2px 24px rgba(0,0,0,0.5);
  }
  .guild  { color:${C.MINT}; }
  .offer  {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:28px; color:${C.MINT};
  }
  .offer-line { width:100px; height:3px; background:${C.MINT}; border-radius:2px; margin:12px auto 0; }
  .save-prompt {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:21px; color:rgba(255,255,255,0.55);
    margin-top:40px; letter-spacing:0.3px; line-height:1.4;
  }
  .bar { position:absolute; bottom:0; left:0; right:0; height:8px; background:${C.MINT}; z-index:2; }
</style></head><body>
  ${overlay('rgba(18,26,36,0.55)')}
  <div class="top">${logoPill()} ${chip(s.slideNumber, total)}</div>
  <div class="layer">
    <div class="divider"></div>
    ${s.headline ? `<div class="headline">${esc(s.headline)}</div>` : ''}
    <div class="kw"><span class="guild">«</span>${esc(s.keyword)}<span class="guild">»</span></div>
    <div class="offer">${esc(s.offer ?? 'Revisamos tu caso gratis')}</div>
    <div class="offer-line"></div>
    ${s.savePrompt ? `<div class="save-prompt">${esc(s.savePrompt)}</div>` : ''}
  </div>
  <div class="bar"></div>
</body></html>`;
}
