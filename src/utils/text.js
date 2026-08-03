// Spanish marketing copy should never use em/en dashes or spaced hyphens as
// punctuation — that's an English convention. This is a deterministic safety
// net applied after generation, independent of how well the model follows
// the equivalent prompt instructions.
export function stripDashes(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/[—–]/g, ',')
    .replace(/\s+-\s+/g, ', ');
}

// GlobeHop's consultation is always free, not just the first one. "Primera
// asesoría gratis" / "asesoría inicial sin costo" implies later ones cost
// money, which is false. Deterministic safety net, same rationale as
// stripDashes above — strips the misleading qualifier, keeps "gratis/gratuita".
function replaceKeepingCase(match, replacement) {
  return /^[A-ZÁÉÍÓÚÑ]/.test(match) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
}

export function fixConsultationClaim(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(/\b(tu|la|una)\s+primera\s+asesor[ií]a\b/gi, '$1 asesoría')
    .replace(/\b(tu|la|una)\s+asesor[ií]a\s+inicial\b/gi, '$1 asesoría')
    // Scoped to "asesoría/consultoría/consulta ... sin costo" specifically —
    // a bare "sin costo" elsewhere (e.g. "matrícula sin costo de inscripción")
    // is unrelated to the consultation claim and must not be rewritten.
    .replace(
      /\b(asesor[ií]a|consultor[ií]a|consulta)\s+(?:inicial\s+)?sin\s+costo(?:\s+alguno)?\b/gi,
      (m, word) => replaceKeepingCase(m, `${word} gratis`)
    );
}

// Generic aspirational clichés flagged in the July marketing review (spec
// section 8.3) — vague enough to apply to any destination or agency, which is
// exactly why they read as repetitive across posts. Unlike stripDashes/
// fixConsultationClaim these can't be mechanically rewritten into something
// equally natural, so this is a detection backstop (used to reject and
// regenerate in pipeline.js's "check" step), not a silent rewrite. Matching
// is accent- and case-insensitive substring matching.
const RESTRICTED_ASPIRATIONAL_PHRASES = [
  'cambia tu vida',
  'tu vida cambia para siempre',
  'tu mejor version',
  'un mundo mas grande',
  'un escenario mas grande',
  'australia te espera',
  'haz realidad tus suenos',
  'el viaje de tu vida',
  'todo es posible',
  'da el salto',
  'el futuro te espera',
];

function stripAccents(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Returns the restricted aspirational phrases found in text (accent/case
 * insensitive), or an empty array if none match.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function flagRestrictedPhrases(text) {
  if (typeof text !== 'string' || !text) return [];
  const normalized = stripAccents(text.toLowerCase());
  return RESTRICTED_ASPIRATIONAL_PHRASES.filter(phrase => normalized.includes(stripAccents(phrase)));
}
