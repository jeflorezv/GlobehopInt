// Allowlisted provider domains for externally-sourced URLs.
// Subdomain matching is applied: 'ideogram.ai' covers api.ideogram.ai, cdn.ideogram.ai, etc.
const ALLOWED_DOMAINS = [
  'ideogram.ai',
  'klingai.com',
  'cloudinary.com',
];

/**
 * Throws if `url` does not belong to an allowed provider domain.
 * Prevents SSRF if an upstream API response ever returns a manipulated URL.
 *
 * @param {string} url      URL to validate
 * @param {string} context  Caller label for the error message (e.g. 'apply-brand')
 */
export function assertAllowedUrl(url, context) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`[${context}] SSRF block: invalid URL "${url}"`);
  }
  const allowed = ALLOWED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  if (!allowed) {
    throw new Error(`[${context}] SSRF block: disallowed host "${host}"`);
  }
}
