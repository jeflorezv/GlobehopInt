// Colombian character profiles for image and video generation.
// Full prompts sourced from Review/GlobeHop_Character_Library.md — photography
// style anchors ("authentic Colombian appearance", "documentary photography",
// "natural skin texture") are critical for Ideogram to render realistic Latin
// American faces rather than generic AI models.
// No city/region of origin is included — appearance descriptors only.
// Gender is alternated deterministically per Airtable record ID so consecutive
// posts naturally rotate between female and male characters.

import { hashStr } from './variety.js';

const FEMALE_PROFILES = [
  // CO_FEMALE_MEDELLIN_01
  '26-year-old Colombian woman, light-medium olive skin, dark brown shoulder-length hair, brown eyes, natural warm smile, casual modern student clothing, realistic Colombian appearance, documentary photography, natural skin texture, candid student lifestyle',
  // CO_FEMALE_CALI_01
  '28-year-old Colombian woman, warm medium brown skin, dark brown wavy hair, brown eyes, athletic-average build, confident friendly expression, casual student clothing, authentic Latin American appearance, documentary photography, natural lighting, real skin texture, candid moment',
  // CO_FEMALE_BARRANQUILLA_01
  '25-year-old Colombian woman, sun-kissed medium tan skin, dark brown curly or wavy hair, brown eyes, energetic natural smile, relaxed casual student clothing, authentic Caribbean Colombian appearance, realistic photography, photojournalistic style, natural skin texture, candid lifestyle moment',
  // CO_FEMALE_BOGOTA_01
  '30-year-old Colombian woman, light olive skin, dark brown straight hair, brown eyes, mature focused expression, casual-professional student clothing with jacket, realistic Colombian appearance, documentary photography, natural lighting, visible skin texture, candid educational campaign',
  // CO_FEMALE_CARTAGENA_01
  '27-year-old Colombian woman, medium-deep warm brown skin, dark brown curly hair, brown eyes, warm expressive smile, casual student clothing, authentic coastal Colombian appearance, realistic photography, documentary style, real skin texture, candid student lifestyle',
  // CO_FEMALE_PEREIRA_01
  '24-year-old Colombian woman, light-medium warm olive skin, long dark brown hair, brown eyes, calm hopeful expression, simple student clothing with backpack, authentic Colombian student appearance, realistic documentary photography, natural light, visible skin texture, candid moment',
];

const MALE_PROFILES = [
  // CO_MALE_MEDELLIN_01
  '27-year-old Colombian man, light-medium olive skin, short dark brown hair, brown eyes, average-athletic build, calm friendly expression, casual modern student clothing, authentic Colombian appearance, realistic photography, documentary style, natural skin texture, candid student lifestyle',
  // CO_MALE_CALI_01
  '29-year-old Colombian man, warm medium brown skin, short dark hair, brown eyes, athletic build, confident expression, casual sporty student clothing with backpack, authentic Latin American appearance, documentary photography, natural lighting, real skin texture, candid lifestyle moment',
  // CO_MALE_BARRANQUILLA_01
  '26-year-old Colombian man, medium tan skin, short dark hair, brown eyes, warm outgoing expression, relaxed casual student clothing, authentic Caribbean Colombian appearance, realistic photography, photojournalistic style, natural skin texture, candid student lifestyle',
  // CO_MALE_BOGOTA_01
  '32-year-old Colombian man, light olive skin, short dark brown hair, brown eyes, mature career-focused expression, casual-professional clothing with jacket, realistic Colombian appearance, documentary photography, natural lighting, visible skin texture, candid education campaign',
  // CO_MALE_BUCARAMANGA_01
  '25-year-old Colombian man, light-medium warm olive skin, short dark hair, brown eyes, slim-average build, curious hopeful expression, simple student clothing with backpack, authentic Colombian student appearance, realistic documentary photography, natural light, visible skin texture, candid moment',
];

// Which profile indices to use per content pillar.
// Indices reference FEMALE_PROFILES or MALE_PROFILES depending on gender.
const PILLAR_POOLS = {
  destination_spotlight: { female: [0, 1, 2], male: [0, 1, 2] },
  student_story:         { female: [0, 5],    male: [0, 4]    },
  visa_tip:              { female: [1, 5],    male: [1, 4]    },
  agency_promo:          { female: [3, 0],    male: [3, 0]    },
};

/**
 * Picks a Colombian character profile for image/video prompts.
 * Gender alternates deterministically based on the Airtable record ID so that
 * consecutive posts naturally rotate. The same record always produces the same
 * character (reproducible re-runs). The character's origin city is never
 * included in the prompt string — appearance descriptors only.
 *
 * @param {object} record  Airtable record object (must have record.id)
 * @param {string} pillar  Content pillar (destination_spotlight | student_story | visa_tip | agency_promo)
 * @returns {{ gender: string, prompt: string }}
 */
export function selectCharacter(record, pillar) {
  const id = record.id ?? '';
  // Salted FNV hash — independent from the location and scene hashes so two
  // records can no longer collide into the same city AND the same face at once.
  const hash = hashStr(`char:${id}`);
  const isFemale = hash % 2 === 0;

  const pool = PILLAR_POOLS[pillar] ?? PILLAR_POOLS.destination_spotlight;
  const indices = isFemale ? pool.female : pool.male;
  const profiles = isFemale ? FEMALE_PROFILES : MALE_PROFILES;
  const idx = indices[(hash >>> 1) % indices.length];

  return {
    gender: isFemale ? 'female' : 'male',
    prompt: profiles[Math.min(idx, profiles.length - 1)],
  };
}
