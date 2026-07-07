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
  'dark sky, night sky, stormy sky, dark dramatic clouds, overcast grey sky, rainy, foggy, gloomy weather, ' +
  'plastic figure, toy figurine, statue, taxidermy, stuffed animal, doll-like animal, ' +
  'waxy skin, glossy skin, synthetic skin, sculpted hair, helmet hair, plastic hair, ' +
  'anthropomorphized animal, exaggerated cute expression, human-like eyes on animal, cartoon eyes, ' +
  'readable signage, legible text, gibberish text, garbled text, sign, signpost, sign board, ' +
  'plaque, placard, interpretive panel, information panel, information board, information kiosk, ' +
  'exhibit label, museum label, informational display, text panel, infographic display, ' +
  'poster, flyer, brochure, pamphlet, menu board, price tag, sticker with text, decal with text, ' +
  'screen, tablet, digital display, any object with printed words, any object with letters, typography, ' +
  'unnatural hair sheen, artificial hair highlights, doll hair, wig-like hair, digital hair rendering, ' +
  'over-defined hair strands, hair rendered as solid mass, comic book look, anime look, over-sharpened, ' +
  'over-processed photo, artificial color grading, excessive contrast, glowing rim light halo';

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
