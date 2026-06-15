/**
 * Parses a JSON string that may contain Claude-specific malformations:
 *   - Response wrapped in markdown code fences
 *   - Literal newlines / tabs / control chars inside string values (illegal in JSON)
 *
 * Three attempts in order:
 *   1. JSON.parse(raw)                     — clean output, fast path
 *   2. JSON.parse(extractedBlock)           — strip surrounding prose / code fences
 *   3. JSON.parse(repairJsonStrings(block)) — fix control chars inside string values
 *
 * @param {string} raw         Raw text from Claude
 * @param {string} [context]   Module name used in error messages
 * @returns {object}
 */
export function parseJson(raw, context = 'generate') {
  try { return JSON.parse(raw); } catch {}

  const extracted = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!extracted) {
    throw new Error(`${context}: no JSON object in Claude response:\n${raw.slice(0, 300)}`);
  }

  try { return JSON.parse(extracted); } catch {}

  try { return JSON.parse(repairJsonStrings(extracted)); } catch {}

  throw new Error(`${context}: unparseable Claude response:\n${extracted.slice(0, 800)}`);
}

/**
 * Stateful character scan: escapes control characters that appear inside JSON
 * string values. Properly skips over existing escape sequences so they are not
 * double-escaped.
 */
function repairJsonStrings(str) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      if (c === '\\') {
        out += c;
        if (i + 1 < str.length) out += str[++i]; // keep escape pair intact
      } else if (c === '"') {
        out += c;
        inStr = false;
      } else if (c === '\n') { out += '\\n';
      } else if (c === '\r') { out += '\\r';
      } else if (c === '\t') { out += '\\t';
      } else if (c < ' ')   { /* drop other illegal control chars */ }
      else { out += c; }
    } else {
      if (c === '"') inStr = true;
      out += c;
    }
  }
  return out;
}
