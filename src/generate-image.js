import { withRetry } from './utils/retry.js';

const IDEOGRAM_URL = 'https://api.ideogram.ai/v1/ideogram-v3/generate';

// Ideogram aspect ratio tokens per post type (V3 format)
const ASPECT_RATIO = {
  single_photo: '3x4',
  reel:         '9x16',
};

const NEGATIVE_PROMPT =
  'text, watermark, logo, overlay, smooth plastic skin, airbrushed skin, overly perfect skin, ' +
  'stock photo aesthetic, generic corporate photography, artificial studio lighting, CGI look, ' +
  'oversaturated HDR, illustration, painting, cartoon, 3D render, blurry background, heavy bokeh, ' +
  'dark sky, night sky, stormy sky, dark dramatic clouds, overcast grey sky, rainy, foggy, gloomy weather';

/**
 * Generates a single image via Ideogram from the visual prompt in ctx.
 * Used for single_photo and reel post types.
 *
 * @param {object} record  Raw Airtable record fields
 * @param {object} ctx     Pipeline context — must contain ctx.visual
 * @returns {Promise<object>} { ...ctx, imageUrl }
 */
export async function generateImage(record, ctx) {
  const tipo        = record['Tipo de post'];
  const aspectRatio = ASPECT_RATIO[tipo] ?? 'ASPECT_2_3';

  const imageUrl = await withRetry(async () => {
    const resp = await fetch(IDEOGRAM_URL, {
      method: 'POST',
      headers: {
        'Api-Key':      process.env.IDEOGRAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt:              ctx.visual,
        negative_prompt:     NEGATIVE_PROMPT,
        aspect_ratio:        aspectRatio,
        style_type:          'REALISTIC',
        magic_prompt_option: 'OFF',
      }),
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
