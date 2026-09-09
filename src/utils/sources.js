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
let cachedVettedFacts = null;

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

// Parses the "## Vetted facts" table — a stricter, fact-checked subset of the
// source list used for visa_tip/student_life, which otherwise never state
// specifics as fact. Each row: | Fact | Detail | Source |.
function parseVettedFacts(markdown) {
  const section = markdown.split(/^## Vetted facts/m)[1];
  if (!section) return [];
  const rows = section.match(/^\|.+\|.+\|.+\|$/gm) ?? [];
  return rows
    .filter(row => !/^\|\s*Fact\s*\|/.test(row) && !/^\|\s*-+\s*\|/.test(row))
    .map(row => {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      const [fact, detail] = cells;
      return fact && detail ? { fact, detail } : null;
    })
    .filter(Boolean);
}

function loadVettedFacts() {
  if (cachedVettedFacts) return cachedVettedFacts;
  try {
    const markdown = fs.readFileSync(SOURCES_FILE, 'utf-8');
    cachedVettedFacts = parseVettedFacts(markdown);
  } catch (err) {
    console.warn(`[sources] could not load vetted facts from ${SOURCES_FILE}: ${err.message}`);
    cachedVettedFacts = [];
  }
  return cachedVettedFacts;
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

/**
 * Formatted text block of officially-verified facts (studyaustralia.gov.au)
 * for visa_tip/student_life grounding. Unlike getSourcesReferenceBlock, these
 * are vetted enough to cite as fact (not paraphrase-only), still excluding
 * exact dollar figures per the pipeline's money-figure ban.
 * Returns '' if the doc is missing/unparsable.
 *
 * @returns {string}
 */
export function getVettedFactsBlock() {
  const facts = loadVettedFacts();
  if (!facts.length) return '';
  return facts.map(f => `- ${f.fact}: ${f.detail}`).join('\n');
}
