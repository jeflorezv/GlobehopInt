import { generateContent }  from './generate-content.js';
import { generateImage }    from './generate-image.js';
import { generateCarousel } from './generate-carousel.js';
import { generateReel }     from './generate-reel.js';
import { applyBrand }       from './apply-brand.js';
import {
  fetchRecord,
  saveStep,
  markError,
} from './save-to-airtable.js';
import { sendErrorAlert } from './send-alert.js';

// Same step sequence for all types; carousel swaps executors at caption + image.
const STEPS = {
  single_photo: ['caption', 'image', 'brand', 'save'],
  carousel:     ['caption', 'image', 'brand', 'save'],
  reel:         ['caption', 'image', 'brand', 'video', 'save'],
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

  if (resumeIdx > 0) {
    console.log(`[pipeline] ${recordId} — resuming from step "${steps[resumeIdx]}" (last done: "${lastDone}")`);
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
      console.error(`[pipeline] ${recordId} — step "${stepName}" failed:`, err);
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
  const brandedSlides = await Promise.all(
    ctx.slides.map(async slide => {
      const { filename } = await applyBrand(slide.imageUrl);
      return { ...slide, imageUrl: toPublicUrl(filename) };
    })
  );
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
          });

    case 'image':
      // Carousel: images were saved with caption; just advance Paso completado
      return tipo === 'carousel'
        ? saveStep(recordId, 'image', {})
        : saveStep(recordId, 'image', { 'URL imagen': ctx.imageUrl });

    case 'brand': {
      if (tipo === 'carousel') {
        return saveStep(recordId, 'brand', { 'Slides JSON': JSON.stringify(ctx.slides) });
      }
      const fields = ctx.imageUrl.startsWith('http') ? { 'URL imagen': ctx.imageUrl } : {};
      return saveStep(recordId, 'brand', fields);
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
  if (record['Caption generado'])   ctx.caption  = record['Caption generado'];
  if (record['Descripción visual']) ctx.visual   = record['Descripción visual'];
  if (record['URL imagen'])         ctx.imageUrl = record['URL imagen'];
  if (record['URL Video'])          ctx.videoUrl = record['URL Video'];

  const slidesJson = record['Slides JSON'];
  if (slidesJson) {
    try { ctx.slides = JSON.parse(slidesJson); } catch {}
  }

  return ctx;
}

function retryUrl(recordId) {
  const base   = (process.env.RAILWAY_PUBLIC_URL ?? '').replace(/\/$/, '');
  const secret = encodeURIComponent(process.env.WEBHOOK_SECRET ?? '');
  return `${base}/retry/${recordId}?secret=${secret}`;
}
