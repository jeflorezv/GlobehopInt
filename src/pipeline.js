import { createHmac }       from 'node:crypto';
import path                 from 'node:path';
import { generateContent }  from './generate-content.js';
import { generateImage }    from './generate-image.js';
import { generateCarousel } from './generate-carousel.js';
import { generateReel }     from './generate-reel.js';
import { applyBrand }       from './apply-brand.js';
import { applyBrandToVideo } from './apply-brand-video.js';
import { humanizeCaption }  from './humanize-caption.js';
import { uploadToCdn, uploadUrlToCdn } from './upload-cdn.js';
import {
  fetchRecord,
  saveStep,
  markError,
} from './save-to-airtable.js';
import { sendErrorAlert } from './send-alert.js';

const STEPS = {
  single_photo: ['caption', 'humanize', 'image', 'brand', 'save'],
  carousel:     ['caption', 'humanize', 'image', 'brand', 'save'],
  // Reels: generate 3 scene images → 3 Kling videos → 4-scene assembly → save
  reel:         ['caption', 'humanize', 'images', 'video', 'save'],
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

    case 'images': {
      // Reel: generate one Ideogram image per scene in parallel
      const scenes = ctx.scenes ?? [];
      if (!scenes.length) throw new Error('[pipeline] images step: ctx.scenes is empty — re-run from caption');
      const results = await Promise.all(
        scenes.map(scene => generateImage(record, { ...ctx, visual: scene.visual }))
      );
      const updatedScenes = scenes.map((scene, i) => ({ ...scene, imageUrl: results[i].imageUrl }));
      return { ...ctx, scenes: updatedScenes };
    }

    case 'brand':
      return tipo === 'carousel'
        ? brandCarousel(ctx)
        : brandSingle(ctx, tipo);

    case 'video': {
      if (tipo === 'reel' && ctx.scenes?.length) {
        // Upload each scene image to CDN (Kling requires public URLs)
        const cdnScenes = await Promise.all(
          ctx.scenes.map(async scene => ({
            ...scene,
            imageUrl: await uploadUrlToCdn(scene.imageUrl),
          }))
        );
        // Generate Kling clips sequentially to stay within API rate limits
        const videoScenes = [];
        for (const scene of cdnScenes) {
          const result = await generateReel(record, { ...ctx, imageUrl: scene.imageUrl, visual: scene.visual });
          videoScenes.push({ ...scene, videoUrl: result.videoUrl });
        }
        const brandedUrl = await applyBrandToVideo(
          videoScenes.map(s => s.videoUrl),
          ctx.hook ?? null,
          videoScenes,
        );
        return { ...ctx, videoUrl: brandedUrl };
      }
      // Single-scene fallback for legacy records
      const afterKling = await generateReel(record, ctx);
      const brandedUrl = await applyBrandToVideo(afterKling.videoUrl, ctx.hook ?? null);
      return { ...afterKling, videoUrl: brandedUrl };
    }

    case 'save':
      return ctx; // persistStep writes Estado=Pendiente revisión

    default:
      throw new Error(`[pipeline] Unknown step: ${stepName}`);
  }
}

// ─── brand helpers ────────────────────────────────────────────────────────────

async function brandSingle(ctx, tipo) {
  if (tipo === 'reel') {
    // Send a CLEAN image to Kling — no Sharp overlays. Text/logo are applied
    // via FFmpeg after the video is generated so Kling never distorts the branding.
    const cdnUrl = await uploadUrlToCdn(ctx.imageUrl);
    return { ...ctx, imageUrl: cdnUrl };
  }
  const { filename, tmpPath } = await applyBrand(ctx.imageUrl, ctx.hook ?? null, false);
  return { ...ctx, tmpPath, imageUrl: toPublicUrl(filename) };
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
      if (tipo === 'carousel') {
        return saveStep(recordId, 'caption', {
          'Caption generado': ctx.caption,
          'Slides JSON':      JSON.stringify(ctx.slides),
        });
      }
      if (tipo === 'reel') {
        return saveStep(recordId, 'caption', {
          'Caption generado':   ctx.caption,
          'Descripción visual': ctx.visual,
          'Hook':               ctx.hook ?? '',
          'Slides JSON':        JSON.stringify(ctx.scenes ?? []),
        });
      }
      return saveStep(recordId, 'caption', {
        'Caption generado':   ctx.caption,
        'Descripción visual': ctx.visual,
        'Hook':               ctx.hook ?? '',
      });

    case 'humanize':
      return saveStep(recordId, 'humanize', { 'Caption generado': ctx.caption });

    case 'image':
      return tipo === 'carousel'
        ? saveStep(recordId, 'image', {})
        : saveStep(recordId, 'image', { 'URL imagen': ctx.imageUrl });

    case 'images':
      // Reel: persist scenes with imageUrls so the video step can resume
      return saveStep(recordId, 'images', {
        'Slides JSON': JSON.stringify(ctx.scenes ?? []),
        'URL imagen':  ctx.scenes?.[0]?.imageUrl ?? '',
      });

    case 'brand': {
      if (tipo === 'carousel') {
        const previewUrl = ctx.slides[0]?.imageUrl;
        return saveStep(recordId, 'brand', {
          'Slides JSON':    JSON.stringify(ctx.slides),
          ...(previewUrl ? { 'Imagen preview': [{ url: previewUrl }] } : {}),
        });
      }
      if (tipo === 'reel') {
        // For reels, brandSingle already uploaded the clean image to Cloudinary.
        // ctx.imageUrl is the permanent CDN URL — save it directly (no local file).
        return saveStep(recordId, 'brand', {
          'URL imagen branded': ctx.imageUrl,
          'Imagen preview':     [{ url: ctx.imageUrl }],
        });
      }
      // single_photo — upload Sharp-branded JPEG from /tmp to Cloudinary
      const cdnUrl = await uploadToCdn(ctx.tmpPath, path.basename(ctx.tmpPath));
      return saveStep(recordId, 'brand', {
        'URL imagen branded': cdnUrl,
        'Imagen preview':     [{ url: cdnUrl }],
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
  const tipo = record['Tipo de post'];
  const ctx  = {};

  if (record['Caption generado'])    ctx.caption  = record['Caption generado'];
  if (record['Descripción visual'])  ctx.visual   = record['Descripción visual'];
  if (record['Hook'])                ctx.hook     = record['Hook'];
  if (record['URL imagen branded'])  ctx.imageUrl = record['URL imagen branded'];
  else if (record['URL imagen'])     ctx.imageUrl = record['URL imagen'];
  if (record['URL Video'])           ctx.videoUrl = record['URL Video'];

  const slidesJson = record['Slides JSON'];
  if (slidesJson) {
    try {
      const parsed = JSON.parse(slidesJson);
      // Reel uses Slides JSON for scene descriptors; carousel uses it for slide data
      if (tipo === 'reel') ctx.scenes = parsed;
      else                 ctx.slides = parsed;
    } catch {}
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
