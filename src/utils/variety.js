// Deterministic variety helpers — topics, scene archetypes, and the shared hash.
// Everything derives from record fields (ID, Fecha publicación, Pilar) so:
//   - the same record always produces the same picks (idempotent retries)
//   - different records spread across the pools with no in-memory state
//
// pickTopic guarantees a different topic for the same pillar on 4+ consecutive
// weeks of the same month (base offset per month + week-of-month rotation).

/**
 * FNV-1a 32-bit string hash. Far better distribution than a character sum:
 * record IDs share the "rec" prefix and a char sum is order-insensitive,
 * which made collisions (identical location + character pairs) frequent.
 *
 * @param {string} str
 * @returns {number} unsigned 32-bit hash
 */
export function hashStr(str = '') {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Specific content angles per pillar for Colombian students heading to Australia.
// Angles only — never cost figures, never visa requirements stated as fact
// (those guard rails live in the generator system prompts).
const TOPIC_BANK = {
  destination_spotlight: [
    'Part-time job culture: cafés, hospitality and how work fits around student life',
    'Weekend escapes: beaches, national parks and road trips near your study city',
    'Australian coffee culture, laneways and brunch as a way of life',
    'Wildlife encounters: koalas, quokkas and kangaroos in everyday life',
    'The multicultural campus: classmates and friends from every continent',
    'Study-life balance: sunshine, sport and the outdoor lifestyle',
    'Getting around as a student: trams, trains, ferries and bikes',
    'Seasons flipped: Christmas on the beach and ski season in July',
    'Regional Australia: smaller cities, calmer pace, closer community',
    'Student food scene: markets, food trucks and international cuisine',
    'Safety and quality of life for international students',
    'English immersion in daily life: accents, slang and how fast you improve',
    'Sports culture: footy, cricket, surf lifesaving and joining a club',
    'Nature at your doorstep: reef, rainforest and mountains in one country',
    'City personalities: what makes each Australian city feel different',
    'First impressions: what surprises Colombians most when they arrive',
  ],
  visa_tip: [
    'Getting organized early: the document-gathering mindset that avoids stress',
    'The genuine student statement: what it is and why honesty wins',
    'Common application mistakes and how to avoid them',
    'Why starting your application months ahead changes everything',
    'Work rights while studying: what to understand before making plans',
    'OSHC health cover: what it is and why it matters from day one',
    'Choosing your English test: IELTS, PTE or Cambridge',
    'Financial preparation: the categories to plan (tuition, housing, transport)',
    'Study pathways: from English course to diploma to university',
    'Staying calm and honest through checks and verification steps',
    'Approved! The pre-departure steps nobody tells you about',
    'Extending your studies from inside Australia',
    'Thinking of going with your partner? What to consider first',
    'Why applications get delayed — and the habits that prevent it',
    'Matching the course type to your real goal',
    'Myths about the Australian student visa, debunked',
  ],
  student_story: [
    'The first week: from airport arrival to the first day of class',
    'From zero English to the first job interview in English',
    'Homesickness and how it fades: finding your people abroad',
    'A day in the life: class in the morning, beach at sunset',
    'The first paycheck abroad: what that moment feels like',
    'Flatmates from three continents: how strangers became family',
    'The video call home that made mom cry of pride',
    'Reinventing at 30+: the professional who started over',
    'From doubt to boarding pass: the moment the decision was made',
    'Learning to live alone: cooking, planning, growing up fast',
    'The teacher or classmate who changed everything',
    'The weekend trip that made every sacrifice worth it',
    'A hard start that turned around: failing first, thriving later',
    'Through a parent’s eyes: watching your child bloom abroad',
    'One year later: the person who came back was someone new',
    'Small daily wins: the day you finally understood the jokes',
  ],
  agency_promo: [
    'What a free GlobeHop consultation actually looks like, step by step',
    'We match the city to your personality — not the other way around',
    'Accompaniment from the first chat to the boarding gate',
    'Real humans answering your questions — no call centers, no bots',
    'How GlobeHop prepares your application right the first time',
    'Course, city and plan built with you, for your case',
    'Post-arrival support: you are not alone when you land',
    'Why personalized guidance beats weeks of confusing Google searches',
    'The GlobeHop checklist: your whole process organized in one place',
    'Hundreds of students accompanied — what they have in common',
    'For parents: how we keep you informed at every step',
    'English test guidance: choosing and preparing without anxiety',
    'Honest advice when you are torn between destinations',
    'What makes an application strong: preparation, timing and truth',
    'Timing your intake: when to start planning for each start date',
    'Meet the humans behind the DMs: the GlobeHop team',
  ],
};

// Visual scene archetypes for single_photo posts — mirrors the archetype list
// in the generate-content system prompt but forces rotation instead of letting
// the model gravitate to the same two or three.
const SCENE_ARCHETYPES = [
  'Group of 2–4 multicultural students laughing together near the landmark — genuine joy, arms around each other',
  'Student with arms open wide facing the ocean, beach, or skyline — freedom, arrival, pure happiness',
  'Student sitting at a busy café terrace with coffee and phone — relaxed, belonging, local life',
  'Student with backpack at the airport: passport in hand, huge smile at the departure board',
  'Student discovering a local weekend market, pointing at something exciting — curiosity and delight',
  'Friends of different backgrounds toasting with coffee or food at a sunny outdoor table',
  'Student entering a modern university building, backpack on, first-day energy, smiling at classmates',
  'Single student reading on a park bench or river bank, peaceful and content, golden light',
  'Student on a rooftop or hilltop lookout, city below, wide grin to camera — life is good',
  'Student mid-stride crossing a lively street or plaza, headphones on, at home in the city',
];

const MS_PER_WEEK = 7 * 24 * 3600 * 1000;

// Continuous week counter anchored to the week's Monday — every post of one
// calendar week shares the same index and consecutive weeks differ by exactly
// 1, so a 16-topic pool cycles through all angles before any repeat.
export function weekIndex(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const monday = new Date(y, m - 1, d - ((date.getDay() + 6) % 7));
  return Math.round(monday.getTime() / MS_PER_WEEK);
}

/**
 * Picks the specific content angle for a record, deterministically.
 * The pillar hash sets a base offset and the publish week advances it, so the
 * same pillar walks the full topic pool week by week — no repeats for 16 weeks.
 *
 * @param {object} record  Airtable record fields (uses Fecha publicación, id)
 * @param {string} pillar  Content pillar
 * @returns {string} topic angle
 */
export function pickTopic(record = {}, pillar = '') {
  const pool  = TOPIC_BANK[pillar] ?? TOPIC_BANK.destination_spotlight;
  const fecha = record['Fecha publicación'] ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return pool[(hashStr(`topic:${pillar}`) + weekIndex(fecha)) % pool.length];
  }
  return pool[hashStr(`topic:${pillar}:${record.id ?? ''}`) % pool.length];
}

/**
 * Picks the visual scene archetype for a single_photo record, deterministically.
 * Salted independently from location and character hashes so the three
 * dimensions never correlate.
 *
 * @param {object} record  Airtable record (uses record.id)
 * @returns {string} scene archetype description
 */
export function pickSceneArchetype(record = {}) {
  return SCENE_ARCHETYPES[hashStr(`scene:${record.id ?? ''}`) % SCENE_ARCHETYPES.length];
}
