// Single source of truth for GlobeHop's official brand values, extracted
// literally from GlobeHop_Brand_Kit_EN.md (repo root) §05-06. Previously
// apply-brand.js and render-carousel.js each hardcoded their own copy of
// these constants independently, and they had already drifted out of sync:
// apply-brand.js's BRAND_MINT was set to the Blue hex (#44539D) instead of
// the real Mint Green (#67BB97), so single_photo/reel CTA pills and accent
// bars rendered in the same color as the tint overlay instead of the
// distinct accent color render-carousel.js already used correctly.
//
// Update this file, not the two consumers, when the brand kit changes.

export const BRAND_COLORS = {
  darkBlue: '#1C2631', // Backgrounds, text on dark
  blue:     '#44539D', // Primary brand colour, headings
  mint:     '#67BB97', // Accents, highlights, success
  red:      '#CF202C', // Accent, attention, energy
  white:    '#FFFFFF', // Backgrounds, reversed text
};

export const BRAND_FONTS = {
  display: 'Nexa',    // Logo & display titles (Nexa Heavy / Nexa ExtraLight)
  body:    'Poppins', // Body & corporate copy (Light / Regular / Medium / Bold)
};

// Minimum reproduction size per the official kit's "04 · Minimum Logo Sizes"
// table: digital/web minimum is 200px wide at 72dpi. The corner icon badge
// previously rendered at ~178px (width * 0.165 on a 1080px frame) — below
// this floor.
export const LOGO_MIN_DIGITAL_PX = 200;
