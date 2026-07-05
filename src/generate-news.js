import Anthropic from '@anthropic-ai/sdk';
import { withRetry } from './utils/retry.js';
import { parseJson } from './utils/parse-json.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL  = 'claude-sonnet-4-6';

const SYSTEM = `
You are a news researcher for GlobeHop, a Colombian international education agency. Your job: find ONE recent news story genuinely useful for Colombian students (and their parents) who are planning to study in Australia.

RELEVANT STORY TYPES (in priority order):
1. Australian student visa / migration policy changes (Subclass 500, work-hour rules, financial requirements, processing changes)
2. Intake dates, application deadlines, scholarship announcements for international students
3. English test changes (IELTS, PTE) or admission requirement news
4. Cost-of-living, accommodation, or student-work news affecting international students
5. Safety, wellbeing, or student-life news relevant to newcomers
6. Australia–Latin America / Colombia education relations

RULES:
- The story must be from roughly the last 14 days. Prefer official or reputable sources (Department of Home Affairs, Study Australia, university announcements, ICEF Monitor, The PIE News, SBS, major Australian outlets).
- Skip stories already covered (a list of previously covered stories may be provided).
- Skip purely political/polemic stories with no practical impact on students.
- If genuinely nothing relevant is found, return {"none": true}.

OUTPUT — valid JSON only, no markdown fences, no explanation:
{"headline": "<original headline>", "source": "<publication name>", "date": "<YYYY-MM-DD>", "url": "<article url>", "summary": "<4-6 sentence summary in Spanish covering what changed and the practical impact for Colombian students or parents>", "whyItMatters": "<1-2 sentences in Spanish: why a Colombian family planning to study in Australia should care>"}
`.trim();

function extractUrl(text = '') {
  return String(text).match(/https?:\/\/[^\s"'<>)]+/)?.[0] ?? null;
}

/**
 * Researches one recent news story for a news_update post.
 * Hybrid sourcing: if the record's Notas field contains a URL, that article is
 * used; otherwise Claude web-searches for the most relevant recent story.
 *
 * @param {object} record          Airtable record fields
 * @param {string[]} coveredStories  Headlines/captions of recent news posts to avoid repeating
 * @returns {Promise<object|null>} { headline, source, date, url, summary, whyItMatters } or null if nothing found
 */
export async function researchNews(record, coveredStories = []) {
  const pastedUrl = extractUrl(record['Notas']);

  const userMessage = [
    pastedUrl
      ? `The GlobeHop team pre-selected this article — base the story on it (search only to read/verify it): ${pastedUrl}`
      : `Search for the most relevant recent news story for Colombian students planning to study in Australia. Today is ${new Date().toISOString().slice(0, 10)}.`,
    coveredStories.length ? [
      'STORIES ALREADY COVERED — do not pick these again:',
      ...coveredStories.map(s => `- ${s.slice(0, 200)}`),
    ].join('\n') : '',
  ].filter(Boolean).join('\n\n');

  const message = await withRetry(() =>
    client.messages.create({
      model:      MODEL,
      max_tokens: 2000,
      system:     SYSTEM,
      tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages:   [{ role: 'user', content: userMessage }],
    })
  );

  const text = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();

  const parsed = parseJson(text, 'generate-news');

  if (parsed.none || !parsed.headline || !parsed.summary) {
    console.log('[generate-news] no usable story found — falling back to evergreen topic');
    return null;
  }

  console.log(`[generate-news] story: "${parsed.headline}" (${parsed.source}, ${parsed.date})`);
  return parsed;
}
