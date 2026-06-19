import { withRetry } from './utils/retry.js';

const IDEOGRAM_URL = 'https://api.ideogram.ai/generate';

// Ideogram aspect ratio tokens per post type (non-reel)
const ASPECT_RATIO = {
  single_photo: 'ASPECT_3_4',
};

// Reels use an explicit resolution instead of aspect_ratio to maximise source image quality.
// RESOLUTION_1152_2048 is the highest native 9:16 portrait resolution in Ideogram V_2.
// Note: resolution and aspect_ratio are mutually exclusive in the Ideogram API.
const REEL_RESOLUTION = 'RESOLUTION_1152_2048';

const NEGATIVE_PROMPT =
  'text, watermark, logo, overlay, smooth plastic skin, airbrushed skin, overly perfect skin, ' +
  'stock photo aesthetic, generic corporate photography, artificial studio lighting, CGI look, ' +
  'oversaturated HDR, illustration, painting, cartoon, 3D render, blurry background, heavy bokeh';

/**
 * Generates a single image via Ideogram from the visual prompt in ctx.
 * Used for single_photo and reel post types.
 *
 * @param {object} record  Raw Airtable record fields
 * @param {object} ctx     Pipeline context — must contain ctx.visual
 * @returns {Promise<object>} { ...ctx, imageUrl }
 */
export async function generateImage(record, ctx) {
  const tipo = record['Tipo de post'];

  const imageUrl = await withRetry(async () => {
    const isReel = tipo === 'reel';
    const imageRequest = {
      prompt:              ctx.visual,
      negative_prompt:     NEGATIVE_PROMPT,
      model:               'V_2',
      style_type:          'REALISTIC',
      magic_prompt_option: 'OFF',
    };
    if (isReel) {
      imageRequest.resolution = REEL_RESOLUTION;
    } else {
      imageRequest.aspect_ratio = ASPECT_RATIO[tipo] ?? 'ASPECT_2_3';
    }

    const resp = await fetch(IDEOGRAM_URL, {
      method: 'POST',
      headers: {
        'Api-Key':      process.env.IDEOGRAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image_request: imageRequest }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[generate-image] Ideogram ${resp.status} body:`, body);
      const err  = new Error(`Ideogram request failed (HTTP ${resp.status})`);
      err.status = resp.status;
      throw err;
    }

    const json = await resp.json();
    const url  = json?.data?.[0]?.url;
    if (!url) throw new Error('Ideogram: no image URL in response (check Railway logs)');
    return url;
  });

  return { ...ctx, imageUrl };
}
