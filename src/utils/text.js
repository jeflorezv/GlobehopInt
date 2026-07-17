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
