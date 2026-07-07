// Shared Ideogram negative prompt for all photo generation (single_photo, reel
// scenes, carousel slide backgrounds). Single source of truth so realism/
// signage/age fixes never drift out of sync between generate-image.js and
// render-carousel.js again.
export const BASE_NEGATIVE_PROMPT =
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
  'over-processed photo, artificial color grading, excessive contrast, glowing rim light halo, ' +
  'middle-aged person, older person, grey hair, greying hair, receding hairline, deep wrinkles, ' +
  'aged skin, age spots, crow\'s feet, forehead wrinkles, worn face, tired older appearance';
