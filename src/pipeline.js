import { createHmac }       from 'node:crypto';
import { generateContent }  from './generate-content.js';
import { generateImage }    from './generate-image.js';
import { generateCarousel } from './generate-carousel.js';
import { generateReel }     from './generate-reel.js';
import { applyBrand }       from './apply-brand.js';
import { humanizeCaption }  from './humanize-caption.js';
import {
  fetchRecord,
  saveStep,
  markError,
} from './save-to-airtable.js';
import { sendErrorAlert } from './send-alert.js';

// Same step sequence for all types; carousel swaps executors at caption + image.
const STEPS = {
  single_photo: ['caption', 'humanize', 'image', 'brand', 'save'],
  carousel:     ['caption', 'humanize', 'image', 'brand', 'save'],
  reel:         ['caption', 'humanize', 'image', 'brand', 'video', 'save'],
};

/**
 * Runs (or resumes) the full generation pipeline for an Airtable record.
 * On any step failure: marks Estado=Error, sends alert email, rethrows.
 *
 * @param {string} recordId  Airtable record ID (e.g. "recXXXXXXXXXXXXXX")
 * @returns {Promise<{ skipped: true } | { success: true }>}
 */
export async function runPipeline(recordId) {
  const record = await fetchRecord(recordId);

  if (record['Estado'] === 'Omitir') {
    console.log(`[pipeline] ${recordId} — skipped (Estado=Omitir)`);
    return { skipped: true };
  }

  const tipo  = record['Tipo de post'];
  const steps = STEPS[tipo];
  if (!steps) throw new Error(`[pipeline] Unknown post type: ${tipo}`);

  // Resume support: skip steps already persisted to Airtable
  const lastDone  = record['Paso completado'];
  const resumeIdx = lastDone ? steps.indexOf(lastDone) + 1 : 0;

  if (resumeIdx > 0 && resumeIdx < steps.length) {
    console.log(`[pipeline] ${recordId} — resuming from step "${steps[resumeIdx]}" (last done: "${lastDone}")`);
  } else if (resumeIdx >= steps.length) {
    console.log(`[pipeline] ${recordId} — all steps already complete (last done: "${lastDone}")`);
  }

  // Reconstruct ctx from saved Airtable fields so resumed steps have prior output
  let ctx = ctxFromRecord(record);

  for (let i = resumeIdx; i < steps.length; i++) {
    const stepName = steps[i];
    console.log(`[pipeline] ${recordId} — step "${stepName}"`);

    try {
      ctx = await runStep(stepName, tipo, record, ctx);
      await persistStep(stepName, tipo, recordId, ctx);
    } catch (err) {
      console.error(`[pipeline] ${recordId} — step "${stepName}" failed: ${err.message}`);
      await markError(recordId, stepName, err.message).catch(() => {});
      await sendErrorAlert({
        recordId,
        stepName,
        error:    err,
        retryUrl: retryUrl(recordId),
      }).catch(() => {});
      throw err;
    }
  }

  console.log(`[pipeline] ${recordId} — complete`);
  return { success: true };
}

// ─── step executor ────────────────────────────────────────────────────────────

async function runStep(stepName, tipo, record, ctx) {
  switch (stepName) {

    case 'caption':
      return tipo === 'carousel'
        ? generateCarousel(record, ctx)
        : generateContent(record, ctx);

    case 'humanize':
      return humanizeCaption(record, ctx);

    case 'image':
      // Carousel already has slide images from the caption step — pass through
      if (tipo === 'carousel') return ctx;
      return generateImage(record, ctx);

    case 'brand':
      return tipo === 'carousel'
        ? brandCarousel(ctx)
        : brandSingle(ctx);

    case 'video':
      return generateReel(record, ctx);

    case 'save':
      return ctx; // persistStep writes Estado=Pendiente revisión

    default:
      throw new Error(`[pipeline] Unknown step: ${stepName}`);
  }
}

// ─── brand helpers ────────────────────────────────────────────────────────────

async function brandSingle(ctx) {
  const { filename } = await applyBrand(ctx.imageUrl, ctx.hook ?? null);
  return { ...ctx, imageUrl: toPublicUrl(filename) };
}

async function brandCarousel(ctx) {
  const brandedSlides = [];
  for (const slide of ctx.slides) {
    const { filename } = await applyBrand(slide.imageUrl);
    brandedSlides.push({ ...slide, imageUrl: toPublicUrl(filename) });
  }
  return { ...ctx, slides: brandedSlides };
}

function toPublicUrl(filename) {
  const base = (process.env.RAILWAY_PUBLIC_URL ?? '').replace(/\/$/, '');
  return `${base}/images/${filename}`;
}

// ─── Airtable persistence per step ───────────────────────────────────────────

async function persistStep(stepName, tipo, recordId, ctx) {
  switch (stepName) {

    case 'caption':
      return tipo === 'carousel'
        ? saveStep(recordId, 'caption', {
            'Caption generado': ctx.caption,
            'Slides JSON':      JSON.stringify(ctx.slides), // raw Ideogram URLs
          })
        : saveStep(recordId, 'caption', {
            'Caption generado':   ctx.caption,
            'Descripción visual': ctx.visual,
            'Hook':               ctx.hook ?? '',
          });

    case 'humanize':
      return saveStep(recordId, 'humanize', { 'Caption generado': ctx.caption });

    case 'image':
      // Carousel: images were saved with caption; just advance Paso completado
      return tipo === 'carousel'
        ? saveStep(recordId, 'image', {})
        : saveStep(recordId, 'image', { 'URL imagen': ctx.imageUrl });

    case 'brand': {
      if (tipo === 'carousel') {
        const previewUrl = ctx.slides[0]?.imageUrl;
        return saveStep(recordId, 'brand', {
          'Slides JSON':    JSON.stringify(ctx.slides),
          ...(previewUrl ? { 'Imagen preview': [{ url: previewUrl }] } : {}),
        });
      }
      // Save branded URL to a dedicated field so resume can distinguish
      // pre-brand (raw Ideogram URL) from post-brand (Railway URL).
      // The attachment field lets reviewers see the image inline in Airtable.
      return saveStep(recordId, 'brand', {
        'URL imagen branded': ctx.imageUrl,
        'Imagen preview':     [{ url: ctx.imageUrl }],
      });
    }

    case 'video':
      return saveStep(recordId, 'video', { 'URL Video': ctx.videoUrl });

    case 'save':
      return saveStep(recordId, 'save', { Estado: 'Pendiente revisión' });
  }
}

// ─── retry resume helpers ─────────────────────────────────────────────────────

/**
 * Reconstructs pipeline context from previously saved Airtable fields.
 * Allows the runner to resume mid-pipeline without re-running completed steps.
 */
function ctxFromRecord(record) {
  const ctx = {};
  if (record['Caption generado'])    ctx.caption  = record['Caption generado'];
  if (record['Descripción visual'])  ctx.visual   = record['Descripción visual'];
  if (record['Hook'])                ctx.hook     = record['Hook'];
  // Prefer the branded Railway URL over the raw Ideogram URL (which expires).
  // 'URL imagen branded' is written only after the brand step succeeds.
  if (record['URL imagen branded'])  ctx.imageUrl = record['URL imagen branded'];
  else if (record['URL imagen'])     ctx.imageUrl = record['URL imagen'];
  if (record['URL Video'])           ctx.videoUrl = record['URL Video'];

  const slidesJson = record['Slides JSON'];
  if (slidesJson) {
    try { ctx.slides = JSON.parse(slidesJson); } catch {}
  }

  return ctx;
}

function retryUrl(recordId) {
  const base  = (process.env.RAILWAY_PUBLIC_URL ?? '').replace(/\/$/, '');
  const token = retryToken(recordId);
  return `${base}/retry/${recordId}?token=${token}`;
}

function retryToken(recordId) {
  const window = Math.floor(Date.now() / (2 * 3600 * 1000));
  return createHmac('sha256', process.env.WEBHOOK_SECRET ?? '')
    .update(`${recordId}:${window}`)
    .digest('hex')
    .slice(0, 32);
}
