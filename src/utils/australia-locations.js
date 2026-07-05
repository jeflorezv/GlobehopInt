// Australia location library for CITY LOCK injection.
// Location is picked deterministically from the Airtable record ID so:
//   - the same record always maps to the same city/landmark (idempotent retries)
//   - different records spread naturally across the full 22-location list
// No in-memory state — deploy restarts have zero effect on variety.
//
// Locations with type:'wildlife' trigger a WILDLIFE SCENE DIRECTIVE in
// generate-content.js that makes the animal the primary visual subject.

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

/**
 * Returns the location for a given Airtable record ID, deterministically.
 * Same record ID always returns the same location. Different IDs spread across
 * all 22 locations via a character-sum hash.
 *
 * @param {string} recordId  Airtable record ID (e.g. "recXXXXXXXXXXXXXX")
 * @returns {{ city, landmark, exclude, type? }}
 */
export function pickAustraliaLocation(recordId = '') {
  const hash = recordId.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0);
  return AUSTRALIA_LOCATIONS[hash % AUSTRALIA_LOCATIONS.length];
}
