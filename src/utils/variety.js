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

// Specific content angles per pillar for Latin American students heading to Australia.
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
    'First impressions: what surprises Latin American students most when they arrive',
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
  city_spotlight: [
    'What your day-to-day cost of living really looks like, broken into categories',
    'Best neighborhoods for students: safety, price range and vibe',
    'Getting around without a car: trains, trams, buses and bike paths',
    'Weekend escapes and day trips within easy reach',
    'The local food scene: markets, cheap eats and student favorites',
    'Where students actually meet each other: clubs, meetups and communities',
    'Safety basics: the areas and habits every new arrival should know',
    'University and campus options in this city, compared',
    'Where the part-time jobs are and which industries hire students',
    'Café and social culture: how locals actually spend a Saturday',
    'Nature at your doorstep: beaches, parks or trails minutes away',
    'The arts and culture scene: galleries, live music, street life',
    'Renting as a student: what to know before you sign',
    'Climate and seasons: what to actually pack',
    'What kind of student thrives here versus in another city',
    'Why this city gets overlooked and why that is a mistake',
  ],
  student_life: [
    'Opening your first Australian bank account: what to expect',
    'Getting a local SIM and staying connected from day one',
    'Getting your Tax File Number: why it matters before your first shift',
    'Finding your first job: where students actually look',
    'Building an Australian-style resume from scratch',
    'Grocery shopping on a student budget: habits that add up',
    'Getting your driver licence or learning to live without one',
    'Share house life: finding flatmates and splitting bills',
    'Meal prepping to save time and money during exam weeks',
    'Public transport passes and student discounts worth knowing',
    'Making local friends outside your own nationality bubble',
    'Managing homesickness with a practical weekly routine',
    'Joining a gym, club or community group in your first month',
    'Understanding your rights as a part-time worker',
    'Setting up healthcare basics beyond OSHC',
    'The first month checklist nobody hands you at the airport',
  ],
  myth_vs_reality: [
    'Myth: studying in Australia is only for the wealthy',
    'Myth: you need perfect English before you arrive',
    'Myth: you cannot work while studying',
    'Myth: the visa process takes years',
    'Myth: it is impossible to study abroad after 30',
    'Myth: you need family already living there to make it work',
    'Myth: Sydney is the only real option in Australia',
    'Myth: studying abroad means starting your career from zero',
    'Myth: international students cannot access good healthcare',
    'Myth: agencies like GlobeHop just add unnecessary cost',
    'Myth: you have to choose between studying and traveling',
    'Myth: your degree from Australia will not be recognized at home',
    'Myth: it is too late to apply for the next intake',
    'Myth: online research is enough, you do not need guidance',
    'Myth: smaller cities have nothing to offer students',
    'Myth: going alone means you will be alone the whole time',
  ],
};

// Visual scene archetypes for single_photo posts — mirrors the archetype list
// in the generate-content system prompt but forces rotation instead of letting
// the model gravitate to the same two or three.
//
// Entries 0-9 are the original tourist/landmark-pose set; 10-15 were added to
// give the pool real everyday-student-life coverage (classroom, library,
// share housing, commute, errands, orientation) — the spec's marketing
// feedback flagged the account as reading like "one tourist poster after
// another" because none of these existed before.
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
  'Student actively participating in a university classroom or tutorial — hand raised or laptop open, engaged discussion with diverse classmates, natural indoor light',
  'Student deep in focused study at a library desk, laptop and notes spread out, quiet concentration, soft window light',
  'Student cooking or doing dishes in a shared house kitchen with flatmates from different backgrounds, casual chatter, everyday domestic warmth',
  'Student commuting on a train, tram, or bus with headphones in and a coffee in hand, city passing by the window, relaxed everyday routine',
  'Student pushing a trolley through a bright supermarket aisle, comparing products, practical everyday errand',
  'Student at a campus orientation or welcome event, name tag or lanyard, meeting new international classmates, first-day energy',
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

// Stride for permuting the continuous post counter across SCENE_ARCHETYPES —
// same technique as australia-locations.js's PERMUTE_STRIDE, chosen coprime
// with the pool length (16) so the mapping is a full bijection. Using a
// different stride (7 vs. locations' 5) keeps the two dimensions independent
// rather than correlated.
const SCENE_STRIDE = 7;

// Posting days → slot index, same mapping as australia-locations.js.
const DAY_SLOTS_SCENE = { 1: 0, 3: 1, 5: 2, 6: 3 }; // Mon, Wed, Fri, Sat

/**
 * Picks the visual scene archetype for a single_photo record, deterministically.
 *
 * The previous implementation (`hashStr('scene:' + id) % 10`) was a pure
 * random draw per record with no rotation guarantee — with 4 posts/week drawn
 * from 10 archetypes the birthday paradox gave roughly a 50% chance of
 * repeating the same pose within a single week. This now uses the same
 * continuous-post-counter + coprime-stride permutation as
 * pickAustraliaLocation, so any 16 consecutive counter values (a ~4-week
 * span) hit every archetype at most once before repeating.
 *
 * @param {object} record  Airtable record (uses record.id, 'Fecha publicación')
 * @returns {string} scene archetype description
 */
export function pickSceneArchetype(record = {}) {
  const n = SCENE_ARCHETYPES.length;
  const fecha = record['Fecha publicación'] ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const date = new Date(...fecha.split('-').map((v, i) => i === 1 ? Number(v) - 1 : Number(v)));
    const slot = DAY_SLOTS_SCENE[date.getDay()] ?? date.getDay() % 4;
    const postCount = weekIndex(fecha) * 4 + slot;
    return SCENE_ARCHETYPES[(postCount * SCENE_STRIDE) % n];
  }
  return SCENE_ARCHETYPES[hashStr(`scene:${record.id ?? ''}`) % n];
}

// The 8 approved hook structures (spec section 8.2) — forces mechanical
// variety in HOW a hook opens, the same way TOPIC LOCK/CITY LOCK/CHARACTER
// LOCK already force variety in topic/location/character. Without this, hook
// rhetorical structure was left entirely to the model's free choice on every
// call, with no memory of what the last N posts used.
const HOOK_STRUCTURES = [
  { id: 'situation_decision',  instruction: 'A recognizable situation the reader is in, followed by the decision it forces' },
  { id: 'error_consequence',   instruction: 'A common mistake students make, followed by its real consequence' },
  { id: 'comparison_criterion',instruction: 'A comparison between two options, built around an unexpected criterion most people never consider' },
  { id: 'profile_next_step',   instruction: 'A concrete student profile, followed by the specific next step that fits them' },
  { id: 'faq_answer',          instruction: 'A real, frequently asked question, followed by a precise, concrete answer' },
  { id: 'number_benefit',      instruction: 'A specific number of items (steps, mistakes, things to check), followed by the clear benefit they add up to' },
  { id: 'myth_correction',     instruction: 'A common myth, followed by the grounded correction' },
  { id: 'process_moment',      instruction: 'A specific moment in the process (applying, visa, arrival), followed by what to check at exactly that point' },
];

/**
 * Picks the hook rhetorical structure for a record, deterministically —
 * same weekIndex-rotation pattern as pickTopic, cycling through all 8
 * structures before any repeat.
 *
 * @param {object} record  Airtable record (uses record.id, 'Fecha publicación')
 * @returns {{ id: string, instruction: string }}
 */
export function pickHookStructure(record = {}) {
  const fecha = record['Fecha publicación'] ?? '';
  const idx = /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? (hashStr('hookStructure') + weekIndex(fecha)) % HOOK_STRUCTURES.length
    : hashStr(`hookStructure:${record.id ?? ''}`) % HOOK_STRUCTURES.length;
  return HOOK_STRUCTURES[idx];
}

// The 4 caption formats already described in generate-content.js's system
// prompt (FORMAT A-D) — previously left to the model's free choice on every
// call ("use one of these proven formats, chosen based on pillar and
// audience") with no rotation or history check.
const CAPTION_FORMATS = ['A', 'B', 'C', 'D'];

/**
 * Picks which caption format (A-D, described in generate-content.js's system
 * prompt) to force for a record, deterministically.
 *
 * @param {object} record  Airtable record (uses record.id, 'Fecha publicación')
 * @returns {string} 'A' | 'B' | 'C' | 'D'
 */
export function pickCaptionFormat(record = {}) {
  const fecha = record['Fecha publicación'] ?? '';
  const idx = /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? (hashStr('captionFormat') + weekIndex(fecha)) % CAPTION_FORMATS.length
    : hashStr(`captionFormat:${record.id ?? ''}`) % CAPTION_FORMATS.length;
  return CAPTION_FORMATS[idx];
}

// Carousel template pools per pillar — narrows generate-carousel.js's fully
// open "choose the most fitting template" instruction down to the templates
// actually tagged for that pillar in its system prompt's template table
// (T01-T21), plus T14 (FAQ, tagged [any]) added to every pool for extra
// variety. Pillars not listed here (e.g. news_update, which the seeding
// scripts never assign to a carousel slot) fall back to the model's free
// choice — pickTemplate returns null and no TEMPLATE LOCK is injected.
const CAROUSEL_TEMPLATES_BY_PILLAR = {
  destination_spotlight: [1, 8, 9, 17, 14],
  city_spotlight:        [21, 14],
  student_story:         [2, 18, 14],
  visa_tip:               [4, 5, 13, 14],
  student_life:            [12, 14],
  myth_vs_reality:         [7, 14],
  agency_promo:            [6, 10, 15, 19, 20, 14],
};

/**
 * Picks the carousel template number for a record, deterministically.
 * Returns null when the pillar has no defined pool (leaves template choice
 * to the model, same as today).
 *
 * @param {object} record  Airtable record (uses record.id, 'Fecha publicación')
 * @param {string} pillar  Content pillar
 * @returns {number|null} template number (1-21) or null
 */
export function pickTemplate(record = {}, pillar = '') {
  const pool = CAROUSEL_TEMPLATES_BY_PILLAR[pillar];
  if (!pool || !pool.length) return null;
  const fecha = record['Fecha publicación'] ?? '';
  const idx = /^\d{4}-\d{2}-\d{2}$/.test(fecha)
    ? (hashStr(`template:${pillar}`) + weekIndex(fecha)) % pool.length
    : hashStr(`template:${pillar}:${record.id ?? ''}`) % pool.length;
  return pool[idx];
}
