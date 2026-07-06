// Curated external sources for grounding news research and adding credibility
// to regular posts. Team-maintained markdown, parsed once at module load so
// edits to the doc don't require touching this file or the generators.
import fs from 'fs';
import path from 'path';

const SOURCES_FILE = path.join(process.cwd(), 'docs', 'latam_students_australia_sources.md');

function parseSources(markdown) {
  const rows = markdown.match(/^\|\s*\[.+\]\(.+\)\s*\|.+\|$/gm) ?? [];
  return rows.map(row => {
    // Split on unescaped pipes only — labels may contain `\|` (e.g. "Maria \| Study Australia").
    const cells = row.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|')).filter(Boolean);
    const [, url] = cells[0]?.match(/\[.+?\]\((.+?)\)/) ?? [];
    const description = cells[1]?.replace(/\[cite:[^\]]*\]/g, '').trim();
    return url && description ? { url, description } : null;
  }).filter(Boolean);
}

let cachedSources = null;

function loadSources() {
  if (cachedSources) return cachedSources;
  try {
    const markdown = fs.readFileSync(SOURCES_FILE, 'utf-8');
    cachedSources = parseSources(markdown);
  } catch (err) {
    console.warn(`[sources] could not load ${SOURCES_FILE}: ${err.message}`);
    cachedSources = [];
  }
  return cachedSources;
}

/**
 * Formatted text block of curated sources for prompt injection.
 * Returns '' if the source doc is missing or empty — callers should treat
 * this as optional grounding, never a hard requirement.
 *
 * @returns {string}
 */
export function getSourcesReferenceBlock() {
  const sources = loadSources();
  if (!sources.length) return '';
  return sources.map(s => `- ${s.description} (${s.url})`).join('\n');
}
