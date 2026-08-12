import { createHmac }       from 'node:crypto';
import path                 from 'node:path';
import { generateContent }  from './generate-content.js';
import { generateImage }    from './generate-image.js';
import { generateCarousel } from './generate-carousel.js';
import { generateReel }     from './generate-reel.js';
import { applyBrand }       from './apply-brand.js';
import { applyBrandToVideo } from './apply-brand-video.js';
import { humanizeCaption }  from './humanize-caption.js';
import { renderCarousel }   from './render-carousel.js';
import { stripDashes, fixConsultationClaim, flagRestrictedPhrases } from './utils/text.js';
import { uploadToCdn, uploadUrlToCdn } from './upload-cdn.js';
import {
  fetchRecord,
  saveStep,
  markError,
} from './save-to-airtable.js';
import { sendErrorAlert } from './send-alert.js';
import { getRegenerationReason } from './utils/regeneration.js';

const STEPS = {
  single_photo: ['caption', 'check', 'humanize', 'image', 'brand', 'save'],
  carousel:     ['caption', 'check', 'humanize', 'render', 'save'],
  reel:         ['caption', 'check', 'humanize', 'images', 'video', 'save'],
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
  record.id = recordId; // fetchRecord returns json.fields only; restore ID for selectCharacter and pickAustraliaLocation

  if (record['Estado'] === 'Omitir') {
    console.log(`[pipeline] ${recordId} — skipped (Estado=Omitir)`);
    return { skipped: true };
  }

  validateRequiredFields(record);

  const destino = record['Destino/Tema'] ?? '';
  if (!/australia/i.test(destino)) {
    console.log(`[pipeline] ${recordId} — skipped (destination="${destino}" is not Australia — only Australia is active)`);
    return { skipped: true };
  }

  const tipo  = record['Tipo de post'];
  const regenerationReason = getRegenerationReason(record['Notas']);
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
      await markError(recordId, stepName, err.message, regenerationReason, record['Notas'] ?? '').catch(() => {});
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

// ─── field validation ─────────────────────────────────────────────────────────

// Spec section 6.4's "matriz editorial mínima": generation should not start
// with a gap in the required fields. Previously an empty Pilar/Audiencia/
// Destino/CTA would silently interpolate as the literal string "undefined"
// into the Claude prompt (see generate-content.js's userMessage template)
// instead of failing loudly. Throwing here reuses the existing error path —
// runPipeline's catch block already marks Estado=Error and sends an alert.
function validateRequiredFields(record) {
  const REQUIRED = ['Pilar', 'Audiencia', 'Destino/Tema', 'CTA', 'Tipo de post'];
  const missing = REQUIRED.filter(field => !record[field]);
  if (missing.length) {
    throw new Error(`[pipeline] Missing required fields: ${missing.join(', ')}`);
  }
}

// ─── step executor ────────────────────────────────────────────────────────────

async function runStep(stepName, tipo, record, ctx) {
  switch (stepName) {

    case 'caption':
      return tipo === 'carousel'
        ? generateCarousel(record, ctx)
        : generateContent(record, ctx);

    case 'check': {
      const COST_PATTERNS = [
        /\$\s*[\d,\.]+/,                   // $15,000 · $2.000.000
        /\b[\d,\.]+\s*\$/,                  // 2.000$
        /\b(AUD|A\$|USD|COP|MXN|CLP)\b/,   // standalone currency codes
        /\b\d{1,3}(?:[.,]\d{3})+\b/,       // formatted numbers: 1,500 · 2.000.000
      ];
      const textFields = [
        ctx.caption,
        ctx.hook,
        ...(ctx.slides ?? []).flatMap(s => [
          s.headline, s.subtext, s.body, s.stat, s.statLabel,
          ...(s.items ?? []),
        ]),
        ...(ctx.scenes ?? []).map(s => s.text),
      ].filter(Boolean);

      for (const pattern of COST_PATTERNS) {
        for (const text of textFields) {
          if (pattern.test(text)) {
            const match = text.match(pattern)?.[0];
            throw new Error(
              `[check] Cost figure detected: "${match}" — regenerate this record to remove all currency symbols and monetary amounts.`
            );
          }
        }
      }

      // Code-level backstop for the generic aspirational clichés flagged in
      // the July marketing review (spec 8.3) — prompt-only instructions had
      // already drifted inconsistently across generate-content.js/generate-
      // carousel.js/humanize-caption.js, which is exactly the failure mode
      // that produced this rule in the first place. Same mechanism as the
      // cost-figure check above: reject early (before humanize spends an API
      // call) so the record surfaces for regeneration instead of publishing.
      for (const text of textFields) {
        const hits = flagRestrictedPhrases(text);
        if (hits.length) {
          throw new Error(
            `[check] Restricted aspirational phrase detected: "${hits[0]}" — regenerate this record with more specific, concrete language.`
          );
        }
      }

      return ctx;
    }

    case 'humanize': {
      const humanized = await humanizeCaption(record, ctx);
      // Deterministic safety nets — run here (after the last step that sets
      // caption/hook/slides/scenes) so nothing downstream reintroduces one.
      // Spanish copy never uses em/en dashes or spaced hyphens as punctuation,
      // and GlobeHop's consultation is always free (never "primera"/"inicial").
      const clean = (t) => fixConsultationClaim(stripDashes(t));
      return {
        ...humanized,
        caption: clean(humanized.caption),
        hook:    clean(humanized.hook),
        slides:  (humanized.slides ?? []).map(s => ({
          ...s,
          headline:   clean(s.headline),
          subtext:    clean(s.subtext),
          body:       clean(s.body),
          stat:       clean(s.stat),
          statLabel:  clean(s.statLabel),
          tag:        clean(s.tag),
          keyword:    clean(s.keyword),
          action:     clean(s.action),
          offer:      clean(s.offer),
          savePrompt: clean(s.savePrompt),
          items:      (s.items ?? []).map(clean),
        })),
        scenes: (humanized.scenes ?? []).map(s => ({ ...s, text: clean(s.text) })),
      };
    }

    case 'render':
      if (tipo === 'carousel') return renderCarousel(record, ctx);
      throw new Error(`[pipeline] render step not supported for tipo="${tipo}"`);

    case 'image':
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
      return brandSingle(ctx, tipo);

    case 'video': {
      if (ctx.videoUrl) {
        console.log(`[pipeline] video step skipped — existing URL Video preserved`);
        return ctx;
      }
      if (tipo === 'reel' && ctx.scenes?.length) {
        const cdnScenes = await Promise.all(
          ctx.scenes.map(async scene => {
            const imageUrl = isIdeogramUrlExpired(scene.imageUrl)
              ? (await generateImage(record, { ...ctx, visual: scene.visual })).imageUrl
              : scene.imageUrl;
            return { ...scene, imageUrl: await uploadUrlToCdn(imageUrl) };
          })
        );
        // Persist the now-permanent CDN URLs immediately, before the Kling loop
        // below can fail partway through. Keeps "Paso completado" at 'images'
        // (unchanged) so a retry still resumes at 'video' — but ctx.scenes on
        // that retry will carry Cloudinary URLs instead of expired Ideogram
        // ones, so isIdeogramUrlExpired short-circuits and already-regenerated
        // scenes aren't paid for and regenerated a second time.
        await saveStep(record.id, 'images', { 'Slides JSON': JSON.stringify(cdnScenes) });
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

function toPublicUrl(filename) {
  const base = (process.env.RAILWAY_PUBLIC_URL ?? '').replace(/\/$/, '');
  return `${base}/images/${filename}`;
}

const IDEOGRAM_EXPIRY_BUFFER_SECONDS = 60;

function isIdeogramUrlExpired(url) {
  if (!url) return true;

  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'ideogram.ai' && !parsed.hostname.endsWith('.ideogram.ai')) return false;

    const exp = Number(parsed.searchParams.get('exp'));
    return !Number.isFinite(exp)
      || Date.now() / 1000 + IDEOGRAM_EXPIRY_BUFFER_SECONDS >= exp;
  } catch {
    return true;
  }
}

// ─── Airtable persistence per step ───────────────────────────────────────────

async function persistStep(stepName, tipo, recordId, ctx) {
  switch (stepName) {

    case 'caption': {
      let result;
      if (tipo === 'carousel') {
        result = await saveStep(recordId, 'caption', {
          'Caption generado': ctx.caption,
          'Slides JSON':      JSON.stringify(ctx.slides),
        });
      } else if (tipo === 'reel') {
        result = await saveStep(recordId, 'caption', {
          'Caption generado':   ctx.caption,
          'Descripción visual': ctx.visual,
          'Hook':               ctx.hook ?? '',
          'Slides JSON':        JSON.stringify(ctx.scenes ?? []),
        });
      } else {
        result = await saveStep(recordId, 'caption', {
          'Caption generado':   ctx.caption,
          'Descripción visual': ctx.visual,
          'Hook':               ctx.hook ?? '',
          ...(ctx.newsMeta ? { Notas: ctx.newsMeta } : {}),
        });
      }
      return result;
    }

    case 'check':
      return saveStep(recordId, 'check', {});

    case 'humanize':
      return saveStep(recordId, 'humanize', { 'Caption generado': ctx.caption });

    case 'render': {
      const slides      = ctx.slides ?? [];
      const previewUrl  = slides[0]?.imageUrl;
      const hookHeadline = slides[0]?.headline ?? '';
      return saveStep(recordId, 'render', {
        'Slides JSON':        JSON.stringify(slides),
        'Hook':               hookHeadline,
        'URL imagen branded': previewUrl ?? '',
        'Imagen preview':     slides.filter(s => s.imageUrl).map(s => ({ url: s.imageUrl })),
      });
    }

    case 'image':
      return saveStep(recordId, 'image', { 'URL imagen': ctx.imageUrl });

    case 'images':
      // Reel: persist scenes with imageUrls so the video step can resume
      return saveStep(recordId, 'images', {
        'Slides JSON': JSON.stringify(ctx.scenes ?? []),
        'URL imagen':  ctx.scenes?.[0]?.imageUrl ?? '',
      });

    case 'brand': {
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
      return saveStep(recordId, 'save', {
        Estado: 'Pendiente revisión',
        ...(ctx.regenerationReason && !ctx.newsMeta ? { Notas: '' } : {}),
      });
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
