// Australia location library for CITY LOCK injection.
// Location is picked deterministically from a continuous post counter (week
// index * 4 + day slot), permuted by a stride coprime with the list length, so:
//   - the same record always maps to the same city/landmark (idempotent retries)
//   - the 4 posts of any one week always land in 4 different cities (consecutive
//     counters map to residues 5 apart, which never collide within a week)
//   - every run of 22 consecutive posts (~5.5 weeks) visits all 22 locations
//     exactly once before any location repeats — this replaces an earlier
//     per-week hash that only guaranteed distinctness *within* a week and let
//     the same city recur across adjacent weeks (e.g. Brisbane's Story Bridge
//     appearing in two posts days apart)
// No in-memory state — deploy restarts have zero effect on variety.
//
// Locations with type:'wildlife' trigger a WILDLIFE SCENE DIRECTIVE in
// generate-content.js that makes the animal the primary visual subject.

import { hashStr, weekIndex } from './variety.js';

export const AUSTRALIA_LOCATIONS = [
  // Melbourne — 4 entries
  { city: 'Melbourne', landmark: 'Federation Square at dusk with Flinders Street Station and its ornate clocks across the tram intersection, warm city glow', exclude: '' },
  { city: 'Melbourne', landmark: "Hosier Lane, Melbourne's iconic street-art laneway, both walls covered in vivid graffiti, afternoon light filtering down", exclude: '' },
  { city: 'Melbourne', landmark: 'St Kilda Beach foreshore at golden hour with the historic St Kilda pier extending into Port Phillip Bay', exclude: '' },
  { city: 'Melbourne', landmark: 'Royal Botanic Gardens Melbourne, manicured lake path with Australian native flora, towering eucalyptus trees', exclude: '' },
  // Brisbane — 3 entries
  { city: 'Brisbane', landmark: "Story Bridge, Brisbane's great steel arch bridge lit at dusk, Brisbane River winding below, South Bank in the distance", exclude: '' },
  { city: 'Brisbane', landmark: 'South Bank Parklands artificial beach with lifeguard tower and Brisbane CBD skyline rising behind the palm trees', exclude: '' },
  { city: 'Brisbane', landmark: 'Lone Pine Koala Sanctuary — a fluffy koala clinging to a eucalyptus branch in close foreground, sanctuary gardens behind', exclude: '', type: 'wildlife' },
  // Perth — 3 entries
  { city: 'Perth', landmark: 'Kings Park hilltop lookout at golden hour, Swan River curving through the valley far below, Perth city skyline on the horizon', exclude: '' },
  { city: 'Perth', landmark: 'Cottesloe Beach, calm Indian Ocean water with turquoise shallows, white sand, limestone rock formations at the far end', exclude: '' },
  { city: 'Perth', landmark: 'Rottnest Island — a wild quokka sitting in sun-drenched coastal scrub with Pinky Beach turquoise water in the background', exclude: '', type: 'wildlife' },
  // Adelaide — 2 entries
  { city: 'Adelaide', landmark: 'Glenelg Beach jetty stretching into calm blue water at sunrise, pastel sky, Adelaide seaside suburb behind', exclude: '' },
  { city: 'Adelaide', landmark: 'Adelaide Central Market, vibrant multicultural produce and food stalls under warm market lighting, shoppers browsing', exclude: '' },
  // Gold Coast — 2 entries
  { city: 'Gold Coast', landmark: 'Burleigh Heads National Park volcanic headland — surfers riding turquoise waves below, rainforest-covered rocky point above', exclude: '' },
  { city: 'Gold Coast', landmark: 'Surfers Paradise beach at sunrise, high-rise skyline reflected in the wet sand at low tide, warm amber light', exclude: '' },
  // Cairns & tropical north — 2 entries
  { city: 'Cairns', landmark: 'Great Barrier Reef pontoon platform, crystal-clear turquoise water, coral reef visible beneath the surface, open ocean horizon', exclude: '' },
  { city: 'Cairns', landmark: 'Daintree Rainforest canopy walk — ancient tree ferns and towering palms, dappled morning light through the canopy', exclude: '' },
  // Sydney — 3 entries (no Opera House or Harbour Bridge)
  { city: 'Sydney', landmark: 'Bondi to Coogee coastal walk, dramatic sandstone cliffs, turquoise ocean below, coastal heathland in foreground', exclude: 'Do NOT show the Sydney Opera House or Harbour Bridge anywhere in this image' },
  { city: 'Sydney', landmark: 'Darling Harbour waterfront at dusk, water reflections, city lights beginning to glow, Pyrmont Bridge in background', exclude: 'Do NOT show the Sydney Opera House or Harbour Bridge anywhere in this image' },
  { city: 'Sydney', landmark: 'Blue Mountains Echo Point lookout — eucalyptus-filled valley stretching to the horizon, Three Sisters rock formation visible', exclude: 'Do NOT show the Sydney Opera House or Harbour Bridge' },
  // Unique destinations — 3 entries
  { city: 'Hobart', landmark: 'Salamanca Market, Georgian sandstone warehouses converted to market stalls, crisp morning light, fresh produce and craft vendors', exclude: '' },
  { city: 'Darwin', landmark: 'Mindil Beach Sunset Market — amber sunset blazing over the Timor Sea, food stall silhouettes, crowd watching the colours fade', exclude: '' },
  { city: 'Kangaroo Island', landmark: 'Wild kangaroos grazing on coastal heathland at dawn, Flinders Chase National Park cliffs and Southern Ocean in the background', exclude: '', type: 'wildlife' },
];

// Stride used to permute the continuous post counter across the location
// list. Must be coprime with AUSTRALIA_LOCATIONS.length (22 = 2 × 11) so the
// mapping is a full bijection — every residue 0..21 is hit exactly once per
// 22 consecutive posts, guaranteeing zero repeats within any 22-post window.
const PERMUTE_STRIDE = 5;

// Posting days → slot index. Other weekdays fall back to getDay() % 4.
const DAY_SLOTS = { 1: 0, 3: 1, 5: 2, 6: 3 }; // Mon, Wed, Fri, Sat

/**
 * Returns the location for a record, deterministically.
 * Uses a continuous post counter (calendar week index * 4 + day slot) permuted
 * across the full location list, so distinctness holds both within a week and
 * across adjacent weeks (a full cycle covers ~5.5 weeks before any repeat).
 * Falls back to a record-ID hash for records with no parseable publish date.
 *
 * @param {object|string} record  Airtable record fields (with .id and
 *                                'Fecha publicación'), or a bare record ID
 * @returns {{ city, landmark, exclude, type? }}
 */
export function pickAustraliaLocation(record = {}) {
  const n = AUSTRALIA_LOCATIONS.length;

  const fecha = typeof record === 'object' ? record['Fecha publicación'] : null;
  if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const date       = new Date(...fecha.split('-').map((v, i) => i === 1 ? Number(v) - 1 : Number(v)));
    const slot       = DAY_SLOTS[date.getDay()] ?? date.getDay() % 4;
    const postCount  = weekIndex(fecha) * 4 + slot;
    return AUSTRALIA_LOCATIONS[(postCount * PERMUTE_STRIDE) % n];
  }

  const id = typeof record === 'string' ? record : record.id ?? '';
  return AUSTRALIA_LOCATIONS[hashStr(`loc:${id}`) % n];
}
