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
