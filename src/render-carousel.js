import puppeteer from 'puppeteer';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadToCdn } from './upload-cdn.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS    = path.resolve(__dirname, '../assets');
const FONTS_DIR = path.join(ASSETS, 'fonts');

// Loaded once at startup and cached for all subsequent render calls.
const [NEXA_HEAVY, NEXA_LIGHT, POPPINS_BOLD, LOGO_ON_DARK, LOGO_ON_LIGHT] = await Promise.all([
  readFile(path.join(FONTS_DIR, 'Nexa-Heavy.ttf')).then(b => b.toString('base64')),
  readFile(path.join(FONTS_DIR, 'Nexa-ExtraLight.ttf')).then(b => b.toString('base64')),
  readFile(path.join(FONTS_DIR, 'Poppins-Bold.ttf')).then(b => b.toString('base64')),
  readFile(path.join(ASSETS, 'logo-transparent.png')).then(b => b.toString('base64')),
  readFile(path.join(ASSETS, 'logo.png')).then(b => b.toString('base64')),
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

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });

    const rendered = [];
    for (const slide of slides) {
      const html = buildSlideHtml(slide, slides.length);
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

function fonts() {
  return `
    @font-face {
      font-family: 'Nexa'; font-weight: 900;
      src: url('data:font/truetype;base64,${NEXA_HEAVY}') format('truetype');
    }
    @font-face {
      font-family: 'Nexa'; font-weight: 200;
      src: url('data:font/truetype;base64,${NEXA_LIGHT}') format('truetype');
    }
    @font-face {
      font-family: 'Poppins'; font-weight: 700;
      src: url('data:font/truetype;base64,${POPPINS_BOLD}') format('truetype');
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
  `;
}

function logo(onDark = true, width = 200) {
  const b64 = onDark ? LOGO_ON_DARK : LOGO_ON_LIGHT;
  return `<img src="data:image/png;base64,${b64}" style="width:${width}px;display:block;" alt="GlobeHop">`;
}

function chip(n, total, dark = false) {
  const bg   = dark ? 'rgba(28,38,49,0.12)' : 'rgba(255,255,255,0.18)';
  const col  = dark ? C.DARK_BLUE : C.WHITE;
  return `<div style="
    background:${bg}; border-radius:30px; padding:8px 22px;
    color:${col}; font-family:'Poppins',sans-serif;
    font-weight:700; font-size:22px; letter-spacing:1px; white-space:nowrap;
  ">${n} / ${total}</div>`;
}

function buildSlideHtml(slide, total) {
  switch (slide.layout) {
    case 'hook':      return hookHtml(slide, total);
    case 'statement': return statementHtml(slide, total);
    case 'list':      return listHtml(slide, total);
    case 'fact':      return factHtml(slide, total);
    case 'cta':       return ctaHtml(slide, total);
    default:          return statementHtml(slide, total);
  }
}

// ─── slide layouts ────────────────────────────────────────────────────────────

function hookHtml(s, total) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>
  ${fonts()}
  body {
    width:1080px; height:1080px; overflow:hidden;
    background:${C.DARK_BLUE};
    display:flex; flex-direction:column;
  }
  .top { display:flex; justify-content:space-between; align-items:flex-start; padding:44px 44px 0; }
  .content {
    flex:1; display:flex; flex-direction:column;
    justify-content:flex-end; padding:0 64px 90px;
  }
  .headline {
    font-family:'Nexa',sans-serif; font-weight:900;
    font-size:82px; line-height:1.06; color:${C.WHITE};
    letter-spacing:-1px; word-break:break-word;
  }
  .subtext {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:28px; color:rgba(255,255,255,0.62);
    margin-top:20px; line-height:1.4;
  }
  .swipe {
    display:flex; justify-content:flex-end; padding:0 64px 18px;
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:20px; color:${C.MINT}; letter-spacing:0.5px;
  }
  .bar { height:8px; background:${C.MINT}; flex-shrink:0; }
</style></head><body>
  <div class="top">${logo(true, 210)} ${chip(s.slideNumber, total)}</div>
  <div class="content">
    <div class="headline">${esc(s.headline)}</div>
    ${s.subtext ? `<div class="subtext">${esc(s.subtext)}</div>` : ''}
  </div>
  <div class="swipe">Desliza para más →</div>
  <div class="bar"></div>
</body></html>`;
}

function statementHtml(s, total) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>
  ${fonts()}
  body {
    width:1080px; height:1080px; overflow:hidden;
    background:${C.BLUE};
    display:flex; flex-direction:column;
  }
  .top { display:flex; justify-content:space-between; align-items:flex-start; padding:44px 44px 0; }
  .content {
    flex:1; display:flex; flex-direction:column;
    justify-content:center; align-items:center; text-align:center;
    padding:0 76px;
  }
  .headline {
    font-family:'Nexa',sans-serif; font-weight:900;
    font-size:74px; line-height:1.08; color:${C.WHITE};
    word-break:break-word;
  }
  .body {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:30px; color:rgba(255,255,255,0.75);
    margin-top:32px; line-height:1.45;
  }
  .accent { width:72px; height:5px; background:${C.MINT}; border-radius:3px; margin-top:40px; }
  .bar { height:8px; background:${C.MINT}; flex-shrink:0; }
</style></head><body>
  <div class="top">${logo(true, 160)} ${chip(s.slideNumber, total)}</div>
  <div class="content">
    <div class="headline">${esc(s.headline)}</div>
    ${s.body ? `<div class="body">${esc(s.body)}</div>` : ''}
    <div class="accent"></div>
  </div>
  <div class="bar"></div>
</body></html>`;
}

function listHtml(s, total) {
  const items = (s.items ?? []).slice(0, 4);
  const rows  = items.map(item => `
    <div style="display:flex;align-items:center;margin-bottom:36px;">
      <div style="
        min-width:48px; height:48px; border-radius:50%;
        background:${C.MINT};
        display:flex; align-items:center; justify-content:center;
        margin-right:28px; flex-shrink:0;
      ">
        <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
          <path d="M2 8L8 14L20 2" stroke="white" stroke-width="3"
            stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <span style="
        font-family:'Poppins',sans-serif; font-weight:700;
        font-size:34px; color:${C.DARK_BLUE}; line-height:1.2;
      ">${esc(item)}</span>
    </div>`).join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>
  ${fonts()}
  body {
    width:1080px; height:1080px; overflow:hidden;
    background:${C.WHITE};
    display:flex; flex-direction:column;
  }
  .top { display:flex; justify-content:space-between; align-items:flex-start; padding:44px 44px 0; }
  .content { flex:1; display:flex; flex-direction:column; justify-content:center; padding:0 64px; }
  .headline {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:46px; color:${C.DARK_BLUE};
    line-height:1.2; word-break:break-word;
  }
  .rule { width:90px; height:6px; background:${C.MINT}; border-radius:3px; margin:22px 0 44px; }
  .bar  { height:8px; background:${C.MINT}; flex-shrink:0; }
</style></head><body>
  <div class="top">${logo(false, 160)} ${chip(s.slideNumber, total, true)}</div>
  <div class="content">
    <div class="headline">${esc(s.headline)}</div>
    <div class="rule"></div>
    <div>${rows}</div>
  </div>
  <div class="bar"></div>
</body></html>`;
}

function factHtml(s, total) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>
  ${fonts()}
  body {
    width:1080px; height:1080px; overflow:hidden;
    background:${C.WHITE};
    display:flex; flex-direction:column;
    position:relative;
  }
  .side-bar {
    position:absolute; top:0; left:0;
    width:14px; height:100%;
    background:linear-gradient(to bottom, ${C.MINT}, ${C.BLUE});
  }
  .top { display:flex; justify-content:space-between; align-items:flex-start; padding:44px 44px 0 80px; }
  .content { flex:1; display:flex; flex-direction:column; justify-content:center; padding:0 64px 0 80px; }
  .headline {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:36px; color:${C.DARK_BLUE};
    margin-bottom:36px; line-height:1.2;
  }
  .stat {
    font-family:'Nexa',sans-serif; font-weight:900;
    font-size:128px; color:${C.BLUE};
    line-height:1; letter-spacing:-3px;
  }
  .stat-label {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:26px; color:${C.MINT};
    text-transform:uppercase; letter-spacing:2.5px;
    margin-top:12px; margin-bottom:32px;
  }
  .body {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:28px; color:rgba(28,38,49,0.60); line-height:1.5;
  }
  .bar { height:8px; background:${C.MINT}; flex-shrink:0; }
</style></head><body>
  <div class="side-bar"></div>
  <div class="top">${logo(false, 160)} ${chip(s.slideNumber, total, true)}</div>
  <div class="content">
    ${s.headline ? `<div class="headline">${esc(s.headline)}</div>` : ''}
    <div class="stat">${esc(s.stat)}</div>
    <div class="stat-label">${esc(s.statLabel)}</div>
    ${s.body ? `<div class="body">${esc(s.body)}</div>` : ''}
  </div>
  <div class="bar"></div>
</body></html>`;
}

function ctaHtml(s, total) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>
  ${fonts()}
  body {
    width:1080px; height:1080px; overflow:hidden;
    background:linear-gradient(145deg, ${C.BLUE} 0%, ${C.DARK_BLUE} 65%);
    display:flex; flex-direction:column;
    align-items:center; justify-content:center;
    text-align:center; position:relative;
  }
  .counter { position:absolute; top:40px; right:44px; }
  .logo-w  { margin-bottom:32px; }
  .divider { width:64px; height:4px; background:${C.MINT}; border-radius:2px; margin:0 auto 44px; }
  .headline {
    font-family:'Poppins',sans-serif; font-weight:700;
    font-size:30px; color:rgba(255,255,255,0.80);
    margin-bottom:24px; line-height:1.35; padding:0 80px;
  }
  .kw {
    font-family:'Nexa',sans-serif; font-weight:900;
    font-size:96px; color:${C.WHITE};
    line-height:1; letter-spacing:-1px; margin-bottom:24px;
  }
  .guild { color:${C.MINT}; }
  .offer { font-family:'Poppins',sans-serif; font-weight:700; font-size:28px; color:${C.MINT}; }
  .offer-line { width:100px; height:3px; background:${C.MINT}; border-radius:2px; margin:12px auto 0; }
</style></head><body>
  <div class="counter">${chip(s.slideNumber, total)}</div>
  <div class="logo-w">${logo(true, 210)}</div>
  <div class="divider"></div>
  ${s.headline ? `<div class="headline">${esc(s.headline)}</div>` : ''}
  <div class="kw"><span class="guild">«</span>${esc(s.keyword)}<span class="guild">»</span></div>
  <div class="offer">${esc(s.offer ?? 'Consulta gratuita')}</div>
  <div class="offer-line"></div>
</body></html>`;
}
