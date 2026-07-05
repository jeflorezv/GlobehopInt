import express from 'express';
import fs from 'fs';
import path from 'path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { runPipeline }             from './pipeline.js';
import { postToInstagram }         from './post-to-instagram.js';
import { postReel }                from './post-reel.js';
import {
  fetchRecord,
  fetchPendingRecords,
  fetchApprovedRecords,
  markEnCola,
  markApproved,
  markPublished,
  markOmitir,
  saveEdits,
} from './save-to-airtable.js';
import { sendPublishConfirmation, sendErrorAlert } from './send-alert.js';

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

if (!process.env.REVIEW_PASSWORD) {
  console.warn('[startup] REVIEW_PASSWORD not set — /review dashboard will return 503');
}

const app  = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.set('trust proxy', 1);

const apiLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

// Tracks in-flight pipeline runs to prevent concurrent writes for the same record
const inFlight = new Set();

// ─── Auth middlewares ──────────────────────────────────────────────────────────

// Requires the master secret in the x-webhook-secret header only (never query string).
// Uses HMAC-normalised constant-time comparison to prevent timing oracle attacks.
function requireSecret(req, res, next) {
  const provided = req.headers['x-webhook-secret'] ?? '';
  const expected = process.env.WEBHOOK_SECRET;
  const key = Buffer.from('gh-webhook');
  const bufA = createHmac('sha256', key).update(provided).digest();
  const bufB = createHmac('sha256', key).update(expected).digest();
  if (!timingSafeEqual(bufA, bufB)) {
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

// Review dashboard auth — accepts REVIEW_PASSWORD in ?token= query param or form body.
// Marketing team bookmarks: https://<railway-url>/review?token=<REVIEW_PASSWORD>
function requireReviewToken(req, res, next) {
  const pw = process.env.REVIEW_PASSWORD;
  if (!pw) {
    return res.status(503)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(errorPage('REVIEW_PASSWORD no está configurado en el servidor. Contacta al administrador.'));
  }
  const token = req.query.token ?? req.body?.reviewToken;
  if (!token || token !== pw) {
    return res.status(401)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(errorPage('Acceso no autorizado. Verifica el enlace de revisión con tu equipo.'));
  }
  next();
}

// ─── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// ─── Generation ───────────────────────────────────────────────────────────────

async function findWeekRecords() {
  const today   = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  const API_KEY = process.env.AIRTABLE_API_KEY;
  const TABLE   = process.env.AIRTABLE_TABLE_NAME ?? 'Contenido Instagram';
  const AT_REST = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`;

  // End of current week (Saturday) in Bogotá.
  const [y, m, d] = today.split('-').map(Number);
  const todayDate   = new Date(y, m - 1, d);
  const daysUntilSat = (6 - todayDate.getDay() + 7) % 7;
  const satDate     = new Date(y, m - 1, d + daysUntilSat);
  const endOfWeek   = [
    satDate.getFullYear(),
    String(satDate.getMonth() + 1).padStart(2, '0'),
    String(satDate.getDate()).padStart(2, '0'),
  ].join('-');

  // DATETIME_FORMAT is required: comparing the raw date field against a
  // 'YYYY-MM-DD' string fails on the equality day (the field renders as a full
  // datetime), which silently excluded records dated exactly today/end-of-week.
  const params = new URLSearchParams({
    filterByFormula:      `AND({Estado} = 'En cola', DATETIME_FORMAT({Fecha publicación}, 'YYYY-MM-DD') <= '${endOfWeek}')`,
    'sort[0][field]':     'Fecha publicación',
    'sort[0][direction]': 'asc',
  });

  const resp = await fetch(`${AT_REST}?${params}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!resp.ok) throw new Error(`Airtable query failed: ${await resp.text()}`);
  const json = await resp.json();
  return (json.records ?? []).map(r => r.id);
}

app.post('/generate-next', requireSecret, apiLimiter, async (req, res) => {
  let recordIds;
  try {
    recordIds = await findWeekRecords();
  } catch (err) {
    return res.status(500).json({ error: `Airtable query failed: ${err.message}` });
  }

  // Filter out records already being processed
  const pending = recordIds.filter(id => !inFlight.has(id));

  if (!pending.length) {
    console.log('[pipeline] /generate-next — no En cola records for this week');
    return res.json({ skipped: true, reason: 'No records En cola for this week' });
  }

  console.log(`[pipeline] /generate-next — starting ${pending.length} record(s): ${pending.join(', ')}`);
  res.json({ accepted: true, count: pending.length, recordIds: pending });

  for (const recordId of pending) {
    inFlight.add(recordId);
    runPipeline(recordId)
      .catch(err => console.error(`[pipeline] ${recordId} background error:`, err.message))
      .finally(() => inFlight.delete(recordId));
  }
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

// ─── Manual publish (API, requires master secret) ────────────────────────────

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
    const postUrl = await publishRecord(recordId, record);
    res.json({ ok: true, postUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Publishes a fetched record to Instagram and marks it Publicado.
// Shared by /publish, /publish-scheduled, and late approvals from the dashboard.
async function publishRecord(recordId, record) {
  const tipo = record['Tipo de post'];
  const { postUrl } = tipo === 'reel'
    ? await postReel(record)
    : await postToInstagram(record);

  await markPublished(recordId, postUrl);
  await sendPublishConfirmation({ recordId, tipo, postUrl }).catch(() => {});
  cleanupTmpFiles(record);
  return postUrl;
}

function bogotaToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

// ─── Retry (HMAC token from alert email) ─────────────────────────────────────

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

// ─── Review dashboard (marketing team approval UI) ───────────────────────────
//
// Flow:
//   1. Make.com triggers /generate-next → pipeline runs → Airtable: Pendiente revisión
//   2. Team opens https://<railway-url>/review?token=<REVIEW_PASSWORD>
//   3. Team clicks a post → sees full preview (image, hook, caption)
//   4. Team clicks "Aprobar y Publicar" → publishes to Instagram → Publicado
//      OR clicks "Rechazar" → Estado: Omitir (removed from queue)

// GET /review?token=X — dashboard listing all Pendiente revisión records
app.get('/review', requireReviewToken, async (req, res) => {
  const token = req.query.token;
  try {
    const [pendingRecords, approvedRecords] = await Promise.all([
      fetchPendingRecords(),
      fetchApprovedRecords(),
    ]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(dashboardHtml(pendingRecords, approvedRecords, token, req.query));
  } catch (err) {
    res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(errorPage(`Error cargando registros: ${err.message}`));
  }
});

// GET /review/:recordId?token=X — full preview of a single record
app.get('/review/:recordId', requireReviewToken, async (req, res) => {
  const { recordId } = req.params;
  const token = req.query.token;
  try {
    const record = await fetchRecord(recordId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(recordDetailHtml(recordId, record, token, req));
  } catch (err) {
    res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8')
      .send(errorPage(`Error: ${err.message}`));
  }
});

// POST /review/:recordId/save-edits — save caption/hook edits, redirect back to detail page
app.post('/review/:recordId/save-edits', requireReviewToken, apiLimiter, async (req, res) => {
  const { recordId } = req.params;
  const token   = req.body?.reviewToken ?? req.query.token;
  const caption = req.body?.caption;
  const hook    = req.body?.hook;
  const back    = `/review/${esc(recordId)}?token=${encodeURIComponent(token)}&saved=1`;

  try {
    await saveEdits(recordId, { caption, hook });
    res.redirect(back);
  } catch (err) {
    console.error('[review] save-edits failed:', err.message);
    res.redirect(`/review/${esc(recordId)}?token=${encodeURIComponent(token)}&error=${encodeURIComponent(err.message)}`);
  }
});

// POST /review/:recordId/approve — mark Aprobado for scheduled auto-publish.
// If the publish date is today or already past, publish immediately in the
// background instead of waiting for the next Mon/Wed/Fri/Sat 8am window —
// otherwise late approvals sit "stuck" for up to two days.
app.post('/review/:recordId/approve', requireReviewToken, apiLimiter, async (req, res) => {
  const { recordId } = req.params;
  const token = req.body?.reviewToken ?? req.query.token;
  const back  = `/review?token=${encodeURIComponent(token)}`;

  try {
    await markApproved(recordId);

    const record = await fetchRecord(recordId);
    const fecha  = record['Fecha publicación'] ?? '';
    if (fecha && fecha <= bogotaToday()) {
      console.log(`[review] ${recordId} approved late (due ${fecha}) — publishing now`);
      res.redirect(`${back}&publishing=1`);
      publishRecord(recordId, record).catch(async err => {
        console.error(`[review] late publish ${recordId} failed: ${err.message}`);
        await sendErrorAlert({ recordId, stepName: 'approve-publish', error: err }).catch(() => {});
      });
      return;
    }

    res.redirect(`${back}&approved=1`);
  } catch (err) {
    console.error('[review] approve failed:', err.message);
    res.redirect(`${back}&error=${encodeURIComponent(err.message)}`);
  }
});

// POST /review/:recordId/reject — set Estado: Omitir, redirect to dashboard
app.post('/review/:recordId/reject', requireReviewToken, apiLimiter, async (req, res) => {
  const { recordId } = req.params;
  const token = req.body?.reviewToken ?? req.query.token;
  const back  = `/review?token=${encodeURIComponent(token)}`;

  try {
    await markOmitir(recordId);
    res.redirect(`${back}&rejected=1`);
  } catch (err) {
    console.error('[review] reject failed:', err.message);
    res.redirect(`${back}&error=${encodeURIComponent(err.message)}`);
  }
});

// ─── Scheduled auto-publish (Make.com fires Mon/Wed/Fri/Sat at 08:00 Bogotá) ──

app.post('/publish-scheduled', requireSecret, apiLimiter, async (req, res) => {
  const today   = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  const API_KEY = process.env.AIRTABLE_API_KEY;
  const TABLE   = process.env.AIRTABLE_TABLE_NAME ?? 'Contenido Instagram';
  const AT_REST = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`;

  // Find all Aprobado records whose publish date is today or earlier (catches any missed days).
  // DATETIME_FORMAT is required — see findWeekRecords for the equality-day pitfall.
  const params = new URLSearchParams({
    filterByFormula:      `AND({Estado} = 'Aprobado', DATETIME_FORMAT({Fecha publicación}, 'YYYY-MM-DD') <= '${today}')`,
    'sort[0][field]':     'Fecha publicación',
    'sort[0][direction]': 'asc',
  });

  let records;
  try {
    const resp = await fetch(`${AT_REST}?${params}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (!resp.ok) throw new Error(`Airtable query failed: ${await resp.text()}`);
    const json = await resp.json();
    records = json.records ?? [];
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch approved records: ${err.message}` });
  }

  if (!records.length) {
    console.log('[publish-scheduled] no Aprobado records due today');
    return res.json({ skipped: true, reason: 'No Aprobado records due today' });
  }

  // Respond immediately — publishing (especially reels) can take minutes
  res.json({ accepted: true, count: records.length, recordIds: records.map(r => r.id) });

  for (const r of records) {
    const recordId = r.id;
    const record   = r.fields;
    const tipo     = record['Tipo de post'];
    try {
      console.log(`[publish-scheduled] publishing ${recordId} (${tipo})`);
      const full = await fetchRecord(recordId);
      const { postUrl } = tipo === 'reel'
        ? await postReel(full)
        : await postToInstagram(full);
      await markPublished(recordId, postUrl);
      await sendPublishConfirmation({ recordId, tipo, postUrl }).catch(() => {});
      cleanupTmpFiles(full);
      console.log(`[publish-scheduled] ${recordId} published: ${postUrl}`);
    } catch (err) {
      console.error(`[publish-scheduled] ${recordId} failed: ${err.message}`);
      await sendErrorAlert({ recordId, stepName: 'publish-scheduled', error: err }).catch(() => {});
    }
  }
});

// ─── Static image serving (Railway /tmp files, branded single_photo) ──────────

app.get('/images/:filename', apiLimiter, (req, res) => {
  const { filename } = req.params;

  if (!filename.match(/^branded-[\w-]+\.jpg$/)) {
    return res.status(400).end();
  }

  res.sendFile(path.join('/tmp', filename), err => {
    if (err && !res.headersSent) return res.status(404).end();
  });
});

app.listen(PORT, () => {
  console.log(`GlobeHop automation server listening on port ${PORT}`);
});

export default app;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanupTmpFiles(record) {
  const tipo = record['Tipo de post'];
  if (tipo === 'carousel') {
    try {
      const slides = JSON.parse(record['Slides JSON'] ?? '[]');
      for (const s of slides) {
        const fn = s.imageUrl?.split('/images/').pop();
        if (fn?.match(/^branded-[\w-]+\.jpg$/)) fs.unlink(path.join('/tmp', fn), () => {});
      }
    } catch {}
  } else {
    const fn = record['URL imagen branded']?.split('/images/').pop();
    if (fn?.match(/^branded-[\w-]+\.jpg$/)) fs.unlink(path.join('/tmp', fn), () => {});
  }
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── HTML: dashboard ──────────────────────────────────────────────────────────

function dashboardHtml(pendingRecords, approvedRecords, token, query = {}) {
  const pendingCount  = pendingRecords.length;
  const approvedCount = approvedRecords.length;
  const t = encodeURIComponent(token);

  let flash = '';
  if (query.approved) {
    flash = '<div class="flash flash-ok">✓ Post aprobado y programado para publicar automáticamente.</div>';
  } else if (query.published) {
    flash = '<div class="flash flash-ok">✓ Post publicado en Instagram exitosamente.</div>';
  } else if (query.publishing) {
    flash = '<div class="flash flash-ok">✓ Post aprobado — la fecha ya pasó, se está publicando en Instagram ahora mismo (revisa en unos minutos).</div>';
  } else if (query.rejected) {
    flash = '<div class="flash flash-warn">Post rechazado y movido a Omitir.</div>';
  } else if (query.error) {
    flash = `<div class="flash flash-err">Error: ${esc(query.error)}</div>`;
  }

  const pendingSection = pendingCount === 0
    ? '<div class="empty"><h2>Todo al día 🎉</h2><p>No hay posts pendientes de revisión.</p></div>'
    : `<div class="section-header">Pendiente de revisión (${pendingCount})</div><div class="grid">${pendingRecords.map(r => cardHtml(r, t)).join('')}</div>`;

  const approvedSection = approvedCount > 0
    ? `<div class="section-header section-header-approved">Programados para publicar (${approvedCount})</div><div class="grid">${approvedRecords.map(r => approvedCardHtml(r)).join('')}</div>`
    : '';

  const body = pendingSection + approvedSection;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GlobeHop · Revisión</title>
<style>
${BASE_CSS}
.header{background:#1c2631;border-bottom:1px solid #2d3b47;padding:14px 20px;display:flex;align-items:center;justify-content:space-between}
.header-title{font-size:16px;font-weight:700}
.badge-count{background:#67BB97;color:#0f1117;font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px}
.flash{padding:12px 20px;font-size:14px;font-weight:500;border-bottom:1px solid}
.flash-ok{background:rgba(103,187,151,.1);color:#67BB97;border-color:rgba(103,187,151,.25)}
.flash-warn{background:rgba(245,158,11,.08);color:#f59e0b;border-color:rgba(245,158,11,.2)}
.flash-err{background:rgba(207,32,44,.08);color:#ef4444;border-color:rgba(207,32,44,.2)}
.empty{padding:80px 20px;text-align:center;color:#52525b}
.empty h2{font-size:20px;margin-bottom:8px;color:#71717a}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;padding:20px}
.card{background:#161b22;border:1px solid #21262d;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;transition:border-color .15s}
.card:hover{border-color:#44539D}
.card-thumb{position:relative;aspect-ratio:4/5;background:#0d1117;overflow:hidden}
.card-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.card-thumb .no-img{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#3f3f46;font-size:13px}
.card-tipo{position:absolute;top:10px;left:10px;background:rgba(28,38,49,.85);backdrop-filter:blur(6px);border:1px solid rgba(68,83,157,.4);color:#8b9cf4;font-size:11px;font-weight:700;text-transform:uppercase;padding:3px 9px;border-radius:6px;letter-spacing:.4px}
.card-body{padding:14px;flex:1;display:flex;flex-direction:column;gap:8px}
.card-dest{font-size:17px;font-weight:700}
.card-fecha{font-size:12px;color:#71717a}
.card-cta{display:block;background:#44539D;color:#fff;text-align:center;padding:11px;border-radius:9px;font-size:14px;font-weight:600;margin-top:auto;transition:background .15s}
.card-cta:hover{background:#3a4589}
.section-header{padding:10px 20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#52525b;border-bottom:1px solid #21262d;border-top:1px solid #21262d;margin-top:4px}
.section-header-approved{color:#67BB97}
.card-approved{opacity:.85}
.card-scheduled-badge{position:absolute;top:10px;right:10px;background:rgba(103,187,151,.9);color:#0a1a12;font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px}
</style>
</head>
<body>
<div class="header">
  <span class="header-title">🌍 GlobeHop · Revisión de contenido</span>
  <span class="badge-count">${pendingCount} pendiente${pendingCount !== 1 ? 's' : ''}</span>
</div>
${flash}
${body}
</body>
</html>`;
}

function cardHtml(record, encodedToken) {
  const id    = record.id;
  const f     = record.fields;
  const tipo  = f['Tipo de post'] ?? '?';
  const dest  = f['Destino/Tema'] ?? 'Sin destino';
  const fecha = f['Fecha publicación'] ?? '';
  const img   = f['URL imagen branded'] ?? f['URL imagen'] ?? '';

  const thumb = img
    ? `<img src="${esc(img)}" alt="${esc(dest)}" loading="lazy">`
    : '<div class="no-img">Sin imagen</div>';

  return `<div class="card">
  <div class="card-thumb">
    ${thumb}
    <span class="card-tipo">${esc(tipo)}</span>
  </div>
  <div class="card-body">
    <div class="card-dest">${esc(dest)}</div>
    <div class="card-fecha">${esc(fecha)}</div>
    <a href="/review/${esc(id)}?token=${encodedToken}" class="card-cta">Revisar contenido →</a>
  </div>
</div>`;
}

function approvedCardHtml(record) {
  const f    = record.fields;
  const tipo = f['Tipo de post'] ?? '?';
  const dest = f['Destino/Tema'] ?? 'Sin destino';
  const fecha = f['Fecha publicación'] ?? '';
  const img  = f['URL imagen branded'] ?? f['URL imagen'] ?? '';

  const thumb = img
    ? `<img src="${esc(img)}" alt="${esc(dest)}" loading="lazy">`
    : '<div class="no-img">Sin imagen</div>';

  return `<div class="card card-approved">
  <div class="card-thumb">
    ${thumb}
    <span class="card-tipo">${esc(tipo)}</span>
    <span class="card-scheduled-badge">✓ Programado</span>
  </div>
  <div class="card-body">
    <div class="card-dest">${esc(dest)}</div>
    <div class="card-fecha">Publica el ${esc(fecha)} · 8:00 a.m.</div>
  </div>
</div>`;
}

// ─── HTML: record detail ──────────────────────────────────────────────────────

function recordDetailHtml(recordId, record, token, req = {}) {
  const tipo     = record['Tipo de post'] ?? '?';
  const dest     = record['Destino/Tema'] ?? 'Sin destino';
  const fecha    = record['Fecha publicación'] ?? '';
  const estado   = record['Estado'] ?? '';
  const caption  = record['Caption generado'] ?? '';
  const hook     = record['Hook'] ?? '';
  const imgUrl   = record['URL imagen branded'] ?? record['URL imagen'] ?? '';
  const videoUrl = record['URL Video'] ?? '';
  const pending  = estado === 'Pendiente revisión';
  const t        = encodeURIComponent(token);

  let mediaHtml = '';
  if (tipo === 'reel' && videoUrl) {
    mediaHtml = `<div class="media"><video controls playsinline src="${esc(videoUrl)}"></video></div>`;
  } else if (tipo === 'carousel') {
    let slides = [];
    try { slides = JSON.parse(record['Slides JSON'] ?? '[]'); } catch {}
    const withImg = slides.filter(s => s.imageUrl);
    if (withImg.length) {
      const urls = JSON.stringify(withImg.map(s => s.imageUrl));
      mediaHtml = `
<div class="cv-wrap">
  <div class="cv-stage">
    <img id="cv-img" src="${esc(withImg[0].imageUrl)}" alt="Slide 1">
    <button class="cv-btn cv-prev" onclick="cvNav(-1)">&#8249;</button>
    <button class="cv-btn cv-next" onclick="cvNav(1)">&#8250;</button>
    <div class="cv-counter"><span id="cv-n">1</span> / ${withImg.length}</div>
  </div>
  <div class="cv-dots" id="cv-dots">${withImg.map((_, i) => `<span class="cv-dot${i===0?' cv-dot-on':''}" onclick="cvGo(${i})"></span>`).join('')}</div>
</div>
<script>
(function(){
  var urls=${urls}, cur=0;
  window.cvNav=function(d){cvGo((cur+d+urls.length)%urls.length);};
  window.cvGo=function(n){
    cur=n;
    document.getElementById('cv-img').src=urls[n];
    document.getElementById('cv-n').textContent=n+1;
    document.querySelectorAll('.cv-dot').forEach(function(d,i){d.className='cv-dot'+(i===n?' cv-dot-on':'');});
  };
})();
</script>`;
    } else if (imgUrl) {
      mediaHtml = `<div class="media"><img src="${esc(imgUrl)}" alt="${esc(dest)}"></div>`;
    }
  } else if (imgUrl) {
    mediaHtml = `<div class="media"><img src="${esc(imgUrl)}" alt="${esc(dest)}"></div>`;
  }

  const savedFlash = req?.query?.saved
    ? '<div class="flash-save">✓ Cambios guardados</div>' : '';
  const errorFlash = req?.query?.error
    ? `<div class="flash-err-inline">Error: ${esc(req.query.error)}</div>` : '';

  const editForm = pending ? `
<div class="edit-section">
  <div class="section-label">Editar copy</div>
  <form method="POST" action="/review/${esc(recordId)}/save-edits" class="edit-form">
    <input type="hidden" name="reviewToken" value="${esc(token)}">
    <div class="field-label">Hook (3 líneas, separadas por \\n)</div>
    <input type="text" name="hook" value="${esc(hook)}" class="hook-input" placeholder="Línea 1\\nLínea 2\\nEscribe «AUSTRALIA»">
    <div class="field-label" style="margin-top:14px">Caption Instagram</div>
    <textarea name="caption" class="caption-edit" rows="10">${esc(caption)}</textarea>
    <button type="submit" class="btn btn-save">Guardar cambios</button>
  </form>
</div>` : '';

  const actionsHtml = pending
    ? `<div class="actions">
  <form method="POST" action="/review/${esc(recordId)}/approve">
    <input type="hidden" name="reviewToken" value="${esc(token)}">
    <button type="submit" class="btn btn-approve">✓ Aprobar</button>
  </form>
  <form method="POST" action="/review/${esc(recordId)}/reject">
    <input type="hidden" name="reviewToken" value="${esc(token)}">
    <button type="submit" class="btn btn-reject" onclick="return confirm('¿Rechazar este post?')">✗ Rechazar</button>
  </form>
</div>`
    : `<div class="status-note">Estado actual: ${esc(estado)}</div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GlobeHop · ${esc(dest)}</title>
<style>
${BASE_CSS}
.back{display:flex;align-items:center;gap:6px;font-size:14px;color:#71717a;padding:14px 20px;border-bottom:1px solid #21262d;transition:color .15s}
.back:hover{color:#e4e4e7}
.preview{max-width:460px;margin:20px auto;padding:0 16px 40px}
.badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.badge{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;padding:3px 10px;border-radius:10px}
.badge-tipo{background:rgba(68,83,157,.25);color:#8b9cf4;border:1px solid rgba(68,83,157,.4)}
.badge-dest{background:rgba(103,187,151,.15);color:#67BB97;border:1px solid rgba(103,187,151,.3)}
.badge-fecha{background:#1c2631;color:#71717a;border:1px solid #2d3b47}
.media{border-radius:12px;overflow:hidden;margin-bottom:18px;background:#161b22}
.media img{display:block;width:100%}
.media video{display:block;width:100%;max-height:70vh;object-fit:contain;background:#000}
.cv-wrap{margin-bottom:18px}
.cv-stage{position:relative;border-radius:12px;overflow:hidden;background:#161b22;aspect-ratio:3/4}
.cv-stage img{display:block;width:100%;height:100%;object-fit:cover}
.cv-btn{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.55);border:none;color:#fff;font-size:36px;line-height:1;padding:8px 14px;cursor:pointer;border-radius:8px;backdrop-filter:blur(4px);transition:background .15s}
.cv-btn:hover{background:rgba(0,0,0,0.8)}
.cv-prev{left:10px}.cv-next{right:10px}
.cv-counter{position:absolute;bottom:12px;right:14px;background:rgba(0,0,0,0.55);color:#fff;font-size:13px;font-weight:700;padding:4px 10px;border-radius:20px;backdrop-filter:blur(4px)}
.cv-dots{display:flex;justify-content:center;gap:6px;padding:10px 0 4px}
.cv-dot{width:8px;height:8px;border-radius:50%;background:#30363d;cursor:pointer;transition:background .15s}
.cv-dot-on{background:#44539D}
.hook{background:#1c2631;border-left:3px solid #44539D;border-radius:0 10px 10px 0;padding:14px 16px;margin-bottom:16px;font-size:15px;font-weight:600;line-height:1.6;white-space:pre-line}
.caption-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#52525b;margin-bottom:8px}
.caption{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:16px;font-size:14px;line-height:1.8;white-space:pre-wrap;word-break:break-word;color:#a1a1aa;max-height:280px;overflow-y:auto;margin-bottom:0}
.actions{display:flex;gap:10px;margin-top:24px}
.btn{flex:1;padding:14px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;border:none;text-align:center;transition:background .15s}
.btn-approve{background:#22c55e;color:#fff}
.btn-approve:hover{background:#16a34a}
.btn-reject{background:#21262d;color:#71717a;border:1px solid #30363d}
.btn-reject:hover{background:#30363d;color:#e4e4e7}
form{flex:1;display:flex}form .btn{width:100%}
.status-note{margin-top:20px;padding:12px 16px;background:#1c2631;border-radius:10px;font-size:14px;color:#71717a;text-align:center}
.edit-section{margin-top:24px;border-top:1px solid #21262d;padding-top:20px}
.section-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#52525b;margin-bottom:12px}
.edit-form{display:flex;flex-direction:column;gap:6px}
.field-label{font-size:12px;color:#71717a;font-weight:600}
.hook-input{width:100%;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 12px;font-size:14px;color:#e4e4e7;font-family:inherit;outline:none;transition:border-color .15s}
.hook-input:focus{border-color:#44539D}
.caption-edit{width:100%;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 12px;font-size:14px;color:#e4e4e7;font-family:inherit;line-height:1.7;resize:vertical;outline:none;transition:border-color .15s}
.caption-edit:focus{border-color:#44539D}
.btn-save{margin-top:10px;background:#44539D;color:#fff;flex:unset;width:100%;padding:12px}
.btn-save:hover{background:#3a4589}
.flash-save{margin-bottom:14px;padding:10px 14px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);border-radius:8px;font-size:13px;color:#22c55e}
.flash-err-inline{margin-bottom:14px;padding:10px 14px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;font-size:13px;color:#ef4444}
</style>
</head>
<body>
<a class="back" href="/review?token=${t}">← Volver al listado</a>
<div class="preview">
  <div class="badges">
    <span class="badge badge-tipo">${esc(tipo)}</span>
    <span class="badge badge-dest">${esc(dest)}</span>
    <span class="badge badge-fecha">${esc(fecha)}</span>
  </div>
  ${mediaHtml}
  ${hook ? `<div class="hook">${esc(hook)}</div>` : ''}
  <div class="caption-label">Caption Instagram</div>
  <div class="caption">${esc(caption)}</div>
  ${savedFlash}${errorFlash}
  ${editForm}
  ${actionsHtml}
</div>
</body>
</html>`;
}

function errorPage(message) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Error · GlobeHop</title></head>
<body style="font-family:-apple-system,sans-serif;padding:32px;background:#0f1117;color:#ef4444">
<p style="font-size:15px">${esc(message)}</p>
</body></html>`;
}

const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f1117;color:#e4e4e7;min-height:100vh}
a{color:inherit;text-decoration:none}
`;
