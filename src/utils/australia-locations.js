// Australia location library for CITY LOCK injection.
// Location is picked deterministically from the record's publish week + day
// slot, so:
//   - the same record always maps to the same city/landmark (idempotent retries)
//   - the 4 posts of any one week always land in 4 different cities (slots are
//     5 indexes apart — wider than the largest same-city group in the list)
//   - the week hash rotates the whole set week over week
// No in-memory state — deploy restarts have zero effect on variety.
//
// Locations with type:'wildlife' trigger a WILDLIFE SCENE DIRECTIVE in
// generate-content.js that makes the animal the primary visual subject.

import { hashStr } from './variety.js';

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

// Gap between same-week slots. Must exceed the widest same-city run in
// AUSTRALIA_LOCATIONS (Melbourne, 4 entries) so weekly picks never share a city.
const SLOT_STRIDE = 5;

// Posting days → slot index. Other weekdays fall back to getDay() % 4.
const DAY_SLOTS = { 1: 0, 3: 1, 5: 2, 6: 3 }; // Mon, Wed, Fri, Sat

/**
 * Returns the location for a record, deterministically.
 * Uses the publish date's week + day slot when available (guarantees 4 distinct
 * cities per week); falls back to a record-ID hash for records with no date.
 *
 * @param {object|string} record  Airtable record fields (with .id and
 *                                'Fecha publicación'), or a bare record ID
 * @returns {{ city, landmark, exclude, type? }}
 */
export function pickAustraliaLocation(record = {}) {
  const n = AUSTRALIA_LOCATIONS.length;

  const fecha = typeof record === 'object' ? record['Fecha publicación'] : null;
  if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    const [y, m, d]  = fecha.split('-').map(Number);
    const date       = new Date(y, m - 1, d);
    const monday     = new Date(y, m - 1, d - ((date.getDay() + 6) % 7));
    const weekKey    = `${monday.getFullYear()}-${monday.getMonth() + 1}-${monday.getDate()}`;
    const slot       = DAY_SLOTS[date.getDay()] ?? date.getDay() % 4;
    return AUSTRALIA_LOCATIONS[(hashStr(`loc:${weekKey}`) + slot * SLOT_STRIDE) % n];
  }

  const id = typeof record === 'string' ? record : record.id ?? '';
  return AUSTRALIA_LOCATIONS[hashStr(`loc:${id}`) % n];
}
