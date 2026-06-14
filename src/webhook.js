import express from 'express';
import fs from 'fs';
import path from 'path';
import { createHmac } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { runPipeline }           from './pipeline.js';
import { postToInstagram }       from './post-to-instagram.js';
import { postReel }              from './post-reel.js';
import { fetchRecord, markEnCola, markPublished } from './save-to-airtable.js';
import { sendPublishConfirmation } from './send-alert.js';

const REQUIRED_ENV = [
  'ANTHROPIC_API_KEY', 'IDEOGRAM_API_KEY',
  'KLING_API_KEY', 'KLING_API_SECRET',
  'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID',
  'INSTAGRAM_ACCOUNT_ID', 'INSTAGRAM_SYSTEM_USER_TOKEN',
  'WEBHOOK_SECRET', 'RAILWAY_PUBLIC_URL',
  'SENDGRID_API_KEY', 'ALERT_EMAIL',
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error('[startup] Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

const app  = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

const apiLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

// Tracks in-flight pipeline runs to prevent concurrent writes for the same record
const inFlight = new Set();

// Requires the master secret in the x-webhook-secret header only (never query string)
function requireSecret(req, res, next) {
  const provided = req.headers['x-webhook-secret'];
  if (!provided || provided !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Accepts either the master secret (header) or a short-lived HMAC token (query string)
// used in one-click retry links sent by email.
function requireRetryToken(req, res, next) {
  const { recordId } = req.params;
  const provided = req.headers['x-webhook-secret'] ?? req.query.token;
  if (!provided) return res.status(401).json({ error: 'Unauthorized' });

  if (provided === process.env.WEBHOOK_SECRET) return next();

  const now = Math.floor(Date.now() / (2 * 3600 * 1000));
  for (const window of [now, now - 1]) {
    const expected = createHmac('sha256', process.env.WEBHOOK_SECRET)
      .update(`${recordId}:${window}`)
      .digest('hex')
      .slice(0, 32);
    if (provided === expected) return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

async function findNextRecord() {
  const today     = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const BASE_ID   = process.env.AIRTABLE_BASE_ID;
  const API_KEY   = process.env.AIRTABLE_API_KEY;
  const TABLE     = process.env.AIRTABLE_TABLE_NAME ?? 'Contenido Instagram';
  const AT_REST   = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`;

  const params = new URLSearchParams({
    filterByFormula: `AND({Estado} = 'En cola', {Fecha publicación} <= '${today}')`,
    'sort[0][field]':     'Fecha publicación',
    'sort[0][direction]': 'asc',
    maxRecords: '1',
  });

  const resp = await fetch(`${AT_REST}?${params}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!resp.ok) throw new Error(`Airtable query failed: ${await resp.text()}`);
  const json = await resp.json();
  return json.records?.[0]?.id ?? null;
}

app.post('/generate-next', requireSecret, apiLimiter, async (req, res) => {
  let recordId;
  try {
    recordId = await findNextRecord();
  } catch (err) {
    return res.status(500).json({ error: `Airtable query failed: ${err.message}` });
  }

  if (!recordId) {
    console.log('[pipeline] /generate-next — no En cola records for today');
    return res.json({ skipped: true, reason: 'No records En cola for today' });
  }

  if (inFlight.has(recordId)) {
    return res.status(409).json({ error: 'Pipeline already running for this record' });
  }

  console.log(`[pipeline] /generate-next — found ${recordId}`);

  res.json({ accepted: true, recordId });

  inFlight.add(recordId);
  runPipeline(recordId)
    .catch(err => console.error(`[pipeline] ${recordId} background error:`, err.message))
    .finally(() => inFlight.delete(recordId));
});

app.post('/generate', requireSecret, apiLimiter, (req, res) => {
  const { recordId } = req.body;
  if (!recordId) return res.status(400).json({ error: 'recordId required' });

  if (inFlight.has(recordId)) {
    return res.status(409).json({ error: 'Pipeline already running for this record' });
  }

  // Respond immediately — Railway's reverse proxy times out long-running HTTP connections
  // (Kling video generation can take 3–5 min). Pipeline continues in the background;
  // result is tracked via Airtable Estado field.
  res.json({ accepted: true, recordId });

  inFlight.add(recordId);
  runPipeline(recordId)
    .catch(err => console.error(`[pipeline] ${recordId} background error:`, err.message))
    .finally(() => inFlight.delete(recordId));
});

app.post('/publish', requireSecret, apiLimiter, async (req, res) => {
  const { recordId } = req.body;
  if (!recordId) return res.status(400).json({ error: 'recordId required' });

  let record;
  try {
    record = await fetchRecord(recordId);
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch record: ${err.message}` });
  }

  if (record['Estado'] !== 'Aprobado') {
    return res.status(400).json({
      error: `Record must be Aprobado to publish, current Estado: ${record['Estado']}`,
    });
  }

  try {
    const tipo = record['Tipo de post'];
    const { postUrl } = tipo === 'reel'
      ? await postReel(record)
      : await postToInstagram(record);

    await markPublished(recordId, postUrl);
    await sendPublishConfirmation({ recordId, tipo, postUrl }).catch(() => {});

    // Clean up branded files from /tmp after successful publish
    if (tipo === 'carousel') {
      try {
        const slides = JSON.parse(record['Slides JSON'] ?? '[]');
        for (const slide of slides) {
          const fn = slide.imageUrl?.split('/images/').pop();
          if (fn?.match(/^branded-[\w-]+\.jpg$/)) fs.unlink(path.join('/tmp', fn), () => {});
        }
      } catch {}
    } else {
      const fn = record['URL imagen branded']?.split('/images/').pop();
      if (fn?.match(/^branded-[\w-]+\.jpg$/)) fs.unlink(path.join('/tmp', fn), () => {});
    }

    res.json({ ok: true, postUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/retry/:recordId', requireRetryToken, apiLimiter, async (req, res) => {
  const { recordId } = req.params;

  if (inFlight.has(recordId)) {
    return res.status(409).json({ error: 'Pipeline already running for this record' });
  }

  try {
    const record = await fetchRecord(recordId);
    const estado = record['Estado'];
    if (estado === 'Aprobado' || estado === 'Publicado') {
      return res.status(400).json({ error: `Cannot retry a record with Estado: ${estado}` });
    }
    await markEnCola(recordId);

    inFlight.add(recordId);
    try {
      const result = await runPipeline(recordId);
      res.json(result);
    } finally {
      inFlight.delete(recordId);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/review/:recordId', requireSecret, async (req, res) => {
  const { recordId } = req.params;

  try {
    const record   = await fetchRecord(recordId);
    const imageUrl = record['URL imagen branded'] ?? record['URL imagen'];
    const caption  = record['Caption generado'] ?? '';
    const hook     = record['Hook'] ?? '';
    const estado   = record['Estado'] ?? '';
    const fecha    = record['Fecha publicación'] ?? '';
    const tipo     = record['Tipo de post'] ?? '';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(reviewHtml({ recordId, imageUrl, caption, hook, estado, fecha, tipo }));
  } catch (err) {
    res.status(500).send(`<pre style="padding:24px;font-family:monospace">Error: ${escHtml(err.message)}</pre>`);
  }
});

function reviewHtml({ recordId, imageUrl, caption, hook, estado, fecha, tipo }) {
  const estadoClass = estado === 'Aprobado' ? 'aprobado' : estado === 'Pendiente revisión' ? 'pendiente' : '';
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GlobeHop — ${escHtml(recordId)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f0f;color:#f0f0f0;padding:24px 16px}
    .wrap{max-width:520px;margin:0 auto}
    .meta{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap}
    .badge{background:#1e1e1e;border:1px solid #333;padding:3px 10px;border-radius:20px;font-size:12px;color:#aaa}
    .badge.aprobado{border-color:#22c55e;color:#22c55e}
    .badge.pendiente{border-color:#f59e0b;color:#f59e0b}
    .img-wrap{position:relative;border-radius:12px;overflow:hidden;margin-bottom:20px;background:#1a1a1a}
    .img-wrap img{display:block;width:100%}
    .img-wrap a{position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,.65);color:#fff;font-size:12px;padding:4px 10px;border-radius:6px;text-decoration:none;backdrop-filter:blur(4px)}
    .hook{background:#141428;border-left:3px solid #44539D;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:16px;font-size:15px;font-weight:600;line-height:1.5;white-space:pre-line}
    .caption{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:16px;font-size:14px;line-height:1.75;white-space:pre-wrap;word-break:break-word}
    .id{margin-top:20px;font-size:11px;color:#444;text-align:center}
  </style>
</head>
<body>
<div class="wrap">
  <div class="meta">
    <span class="badge">${escHtml(tipo)}</span>
    <span class="badge">${escHtml(fecha)}</span>
    <span class="badge ${estadoClass}">${escHtml(estado)}</span>
  </div>
  ${imageUrl
    ? `<div class="img-wrap"><img src="${escHtml(imageUrl)}" alt="Post preview" loading="eager"><a href="${escHtml(imageUrl)}" target="_blank" rel="noopener">Ver completa ↗</a></div>`
    : `<p style="color:#555;margin-bottom:20px;font-size:14px">Sin imagen</p>`
  }
  ${hook ? `<div class="hook">${escHtml(hook)}</div>` : ''}
  <div class="caption">${escHtml(caption)}</div>
  <p class="id">${escHtml(recordId)}</p>
</div>
</body>
</html>`;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

app.get('/images/:filename', (req, res) => {
  const { filename } = req.params;

  if (!filename.match(/^branded-[\w-]+\.jpg$/)) {
    return res.status(400).end();
  }

  const filePath = path.join('/tmp', filename);

  res.sendFile(filePath, err => {
    if (err && !res.headersSent) return res.status(404).end();
  });
});

app.listen(PORT, () => {
  console.log(`GlobeHop automation server listening on port ${PORT}`);
});

export default app;
