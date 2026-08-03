// Colombian character profiles for image and video generation.
// Full prompts sourced from Review/GlobeHop_Female_Male_Character_Library.md —
// photography style anchors ("authentic Colombian appearance", "documentary
// photography", "natural skin texture") are critical for Ideogram to render
// realistic Latin American faces rather than generic AI models.
// City/region of origin is stripped from the prompt text (appearance
// descriptors only) but every profile still traces back to a region via its
// comment, so the full regional roster keeps rotating under the hood.
// Gender is alternated deterministically per Airtable record ID; the profile
// index rotates through the full pool via the publish week PLUS the day slot
// (mirrors australia-locations.js's DAY_SLOTS) so every region appears before
// any repeat, and two same-gender posts in the same calendar week no longer
// collide on the exact same profile (a real bug: the old index depended only
// on week + gender, so any two same-week same-gender posts got the byte-
// identical character description).

import { hashStr, weekIndex } from './variety.js';

// Posting days → slot index, same mapping as australia-locations.js.
const DAY_SLOTS = { 1: 0, 3: 1, 5: 2, 6: 3 }; // Mon, Wed, Fri, Sat

const FEMALE_PROFILES = [
  // CO_FEMALE_MEDELLIN_01
  '26-year-old Colombian woman, light-medium olive skin, dark brown shoulder-length hair, brown eyes, natural warm smile, casual modern student clothing, realistic Colombian appearance, documentary photography, natural skin texture, candid student lifestyle',
  // CO_FEMALE_MEDELLIN_02
  '25-year-old Colombian woman, light-medium olive skin with warm golden undertones, sleek straight dark brown hair parted down the center, expressive almond-shaped brown eyes, warm open smile, natural facial structure with visible skin pores and fine laugh lines, crisp white casual button-up shirt, minimal modern gold ring, authentic Colombian appearance, documentary photography style, soft indoor natural window lighting, raw unedited skin texture, candid student lifestyle',
  // CO_FEMALE_CALI_01
  '28-year-old Colombian woman, warm medium brown skin, dark brown wavy hair, brown eyes, athletic-average build, confident friendly expression, casual student clothing, authentic Latin American appearance, documentary photography, natural lighting, real skin texture, candid moment',
  // CO_FEMALE_CALI_02
  '27-year-old Colombian woman, warm caramel skin tone, long voluminous dark brown wavy hair catching the light, deep warm brown eyes, genuine radiant smile, athletic-average silhouette with natural curves, confident relaxed posture, simple black casual top, classic metallic gold wristwatch, authentic Colombian appearance, realistic photography, golden hour ambient sunlight, natural skin texture with micro-pores, candid moment',
  // CO_FEMALE_BARRANQUILLA_01
  '25-year-old Colombian woman, sun-kissed medium tan skin, dark brown curly or wavy hair, brown eyes, energetic natural smile, relaxed casual student clothing, authentic Caribbean Colombian appearance, realistic photography, photojournalistic style, natural skin texture, candid lifestyle moment',
  // CO_FEMALE_BARRANQUILLA_02
  '23-year-old Colombian woman, sun-kissed medium tan skin with a soft dewy sheen, voluminous dark brown curly Afro-textured hair, wide-set amber-brown eyes, soft natural facial contours, casual white t-shirt, dark denim overalls, authentic Caribbean Colombian appearance, real documentary photography, vibrant natural daylight, real skin texture with subtle moles, unedited look, candid outdoor moment',
  // CO_FEMALE_BOGOTA_01
  '27-year-old Colombian woman, light olive skin, dark brown straight hair, brown eyes, confident focused expression, casual-professional student clothing with jacket, realistic Colombian appearance, documentary photography, natural lighting, visible skin texture, candid educational campaign',
  // CO_FEMALE_BOGOTA_02
  '24-year-old Colombian woman, fair skin with natural rosy cheeks, thick natural dark eyebrows, striking light hazel-green eyes, long straight dense jet-black hair framing her face, open genuine happy smile, yellow Colombia football jersey, casual student setting, authentic Colombian appearance, photojournalistic style, natural direct daylight, visible skin texture and natural imperfections, candid moment',
  // CO_FEMALE_CARTAGENA_01
  '27-year-old Colombian woman, medium-deep warm brown skin, dark brown curly hair, brown eyes, warm expressive smile, casual student clothing, authentic coastal Colombian appearance, realistic photography, documentary style, real skin texture, candid student lifestyle',
  // CO_FEMALE_CARTAGENA_02
  '26-year-old Afro-Colombian woman, deep mahogany skin with a radiant natural sheen, dark micro-braids styled down her back, statuesque athletic frame, toned long limbs, simple coral-colored summer top and shorts, authentic Afro-Colombian appearance, high-fidelity documentary style, soft coastal light, natural skin pores and texture, completely un-airbrushed, candid moment',
  // CO_FEMALE_PEREIRA_01
  '24-year-old Colombian woman, light-medium warm olive skin, long dark brown hair, brown eyes, calm hopeful expression, simple student clothing with backpack, authentic Colombian student appearance, realistic documentary photography, natural light, visible skin texture, candid moment',
];

const MALE_PROFILES = [
  // CO_MALE_MEDELLIN_01
  '27-year-old Colombian man, light-medium olive skin, short dark brown hair, brown eyes, average-athletic build, calm friendly expression, casual modern student clothing, authentic Colombian appearance, realistic photography, documentary style, natural skin texture, candid student lifestyle',
  // CO_MALE_MEDELLIN_02
  '28-year-old Colombian man, light-medium warm olive skin, short slightly wavy dark brown hair with natural volume, brown eyes, light natural beard stubble, average-athletic build, smart casual clothing with open-collar shirt and simple jacket, confident relaxed expression, authentic Colombian appearance, documentary photography, soft natural light, visible skin pores, candid education campaign',
  // CO_MALE_CALI_01
  '29-year-old Colombian man, warm medium brown skin, short dark hair, brown eyes, athletic build, confident expression, casual sporty student clothing with backpack, authentic Latin American appearance, documentary photography, natural lighting, real skin texture, candid lifestyle moment',
  // CO_MALE_CALI_02
  '24-year-old Colombian man, warm medium tan skin, short black natural curly hair, brown eyes, athletic build with strong shoulders, relaxed casual student clothing, checked shirt with rolled sleeves, warm genuine smile, authentic Colombian appearance, realistic documentary photography, golden hour natural light, visible skin texture, candid lifestyle moment',
  // CO_MALE_BARRANQUILLA_01
  '26-year-old Colombian man, medium tan skin, short dark hair, brown eyes, warm outgoing expression, relaxed casual student clothing, authentic Caribbean Colombian appearance, realistic photography, photojournalistic style, natural skin texture, candid student lifestyle',
  // CO_MALE_BARRANQUILLA_02
  '25-year-old Colombian man, medium brown skin with warm golden undertones, short black curly hair with a natural textured top, dark brown eyes, strong average-athletic build, relaxed casual student clothing, green button-up shirt, simple accessories, genuine warm smile, authentic Caribbean Colombian appearance, documentary photography, natural daylight, visible pores, candid student lifestyle',
  // CO_MALE_BOGOTA_01
  '27-year-old Colombian man, light olive skin, short dark brown hair, brown eyes, confident career-focused expression, casual-professional clothing with jacket, realistic Colombian appearance, documentary photography, natural lighting, visible skin texture, candid education campaign',
  // CO_MALE_BOGOTA_02
  '23-year-old Colombian man, light olive skin with soft rosy undertones, thick dark brown hair in a youthful side-swept style, brown eyes, slim-average build, casual student clothing, light blue button-up shirt, jeans and backpack, curious determined expression, authentic Colombian appearance, documentary photography, natural outdoor daylight, real skin texture, candid education moment',
  // CO_MALE_BUCARAMANGA_01
  '25-year-old Colombian man, light-medium warm olive skin, short dark hair, brown eyes, slim-average build, curious hopeful expression, simple student clothing with backpack, authentic Colombian student appearance, realistic documentary photography, natural light, visible skin texture, candid moment',
  // CO_MALE_BUCARAMANGA_02
  '26-year-old Colombian man, light-medium olive skin, short thick dark hair with natural volume, brown eyes, slim-average build, simple casual student clothing, grey linen shirt, calm sincere expression, authentic Colombian appearance, realistic documentary photography, soft natural light, visible pores and natural smile lines, candid student portrait',
  // CO_MALE_CARTAGENA_01
  '24-year-old Colombian man, deep medium brown skin with warm undertones, short black curly hair, dark brown eyes, strong naturally athletic build, casual coastal student clothing, blue shirt and simple bracelet, grounded confident expression, authentic coastal Colombian appearance, documentary photography, natural outdoor sunlight, natural skin texture, candid student lifestyle',
  // CO_MALE_PEREIRA_01
  '24-year-old Colombian man, light-medium olive skin, thick dark brown hair with soft natural waves, brown eyes, slim-average build, casual student clothing, cream polo shirt, backpack and simple watch, hopeful friendly expression, authentic Colombian appearance, realistic documentary photography, natural outdoor lighting, visible skin texture, candid student moment',
];

/**
 * Picks a Colombian character profile for image/video prompts.
 * Gender alternates deterministically based on the Airtable record ID so that
 * consecutive posts naturally rotate. All pillars draw from the same full
 * pool — the profile index rotates through every regional profile via the
 * publish week (same mechanism as pickTopic) before any repeat, falling back
 * to a record-ID hash when there's no parseable publish date. The character's
 * origin city is never included in the prompt string — appearance
 * descriptors only.
 *
 * @param {object} record  Airtable record object (must have record.id)
 * @returns {{ gender: string, prompt: string }}
 */
export function selectCharacter(record = {}) {
  const id = record.id ?? '';
  const isFemale = hashStr(`char:${id}`) % 2 === 0;
  const profiles = isFemale ? FEMALE_PROFILES : MALE_PROFILES;

  const fecha = record['Fecha publicación'] ?? '';
  let idx;
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const date = new Date(...fecha.split('-').map((v, i) => i === 1 ? Number(v) - 1 : Number(v)));
    const slot = DAY_SLOTS[date.getDay()] ?? date.getDay() % 4;
    idx = (hashStr(`char:${isFemale ? 'female' : 'male'}`) + weekIndex(fecha) * 4 + slot) % profiles.length;
  } else {
    idx = hashStr(`char:idx:${id}`) % profiles.length;
  }

  return {
    gender: isFemale ? 'female' : 'male',
    prompt: profiles[idx],
  };
}
