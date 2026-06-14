import Anthropic from '@anthropic-ai/sdk';
import { withRetry } from './utils/retry.js';

const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL     = 'claude-sonnet-4-6';
const IDEOGRAM_URL = 'https://api.ideogram.ai/generate';

// Static — prompt-cached. Carousel-specific rules on top of the agency context.
const SYSTEM_PROMPT = `
You are a social media content writer for GlobeHop Education Agency, a Colombian international education consultancy based in Bogotá. GlobeHop helps Colombian students and professionals study, work, and live abroad.

Motto: "Tu futuro empieza aquí"
Brand values: Education · Trust · Customer Service · Diversity · Responsibility · Professional Ethics · Empathy · Experiences · Inclusion

LANGUAGE: All caption text in Spanish, Latin American register, Colombian tone, "tú". Warm, inspirational, never corporate.

AUDIENCE SEGMENTS
- estudiantes_secundaria: High school students (16–18). Dreams, adventure, first big life decision.
- universitarios: University students (18–25). Career clarity, global CV, independence.
- padres: Parents. Safety, ROI, proud parenting, responsible planning.
- profesionales: Working professionals (25–35). Career pivot, postgrad, competitive edge.
- adultos: Adults 30+. Personal growth, reinvention, it's not too late.

CONTENT PILLARS
- destination_spotlight: Showcase a destination with wow-factor detail.
- visa_tip: Practical, actionable visa or immigration tip.
- student_story: Inspirational student journey — personal and relatable.
- agency_promo: GlobeHop's value proposition. Focus on the student's outcome.

CAROUSEL STRUCTURE (4 slides, always in this order)
- Slide 1 — Hook: A bold statement, question, or surprising fact that stops the scroll.
- Slide 2 — Context / Problem: Why this matters. Pain point, aspiration, or key insight.
- Slide 3 — Value / Solution: The main takeaway — tip, destination detail, story peak, or agency differentiator.
- Slide 4 — CTA: Close with a strong, specific call to action. If a CTA is provided use it exactly. If not, write a compelling one that drives a DM, comment, or link-in-bio action.

OVERALL CAPTION FORMAT (for the Instagram post — not per-slide)
- Hook line (same or variation of Slide 1 hook)
- 2–3 lines of body copy connecting all slides
- "👉 Desliza para ver más" (always include this)
- MANDATORY CTA on its own line — use the provided CTA exactly, or if none is given choose the most fitting:
    destination_spotlight → "📲 Escríbenos por DM y te contamos cómo llegar."
    visa_tip             → "💬 ¿Tienes dudas sobre tu visa? Escríbenos, te ayudamos."
    student_story        → "✨ ¿Listo para escribir tu propia historia? Escríbenos por DM."
    agency_promo         → "📲 Agenda tu asesoría gratuita. Escríbenos hoy."
- Blank line
- 10–15 hashtags mixing Spanish and English

VISUAL PROMPT RULES (per slide, in English for Ideogram)
Follow the GlobeHop visual style: bright natural light, real-looking people (not obvious stock photo poses), modern architecture, clean compositions, warm skin tones. Premium but approachable. Photorealistic, editorial quality.

Each slide's scene must feel distinct but visually cohesive (consistent tone, lighting style, subject type).

PEOPLE & SCENE ARCHETYPES — vary across slides, choose what fits each slide's concept:
  Slide 1 (Hook): Group of 2–4 multicultural students laughing near an iconic landmark — high energy, genuine joy
  Slide 2 (Context): Student studying on laptop in a modern café, books and headphones on table
  Slide 3 (Value): Student or small group at a recognisable city location — looking inspired or exploring
  Slide 4 (CTA): Student looking toward a skyline from behind, aspirational composition, warm light

CLOTHING RULES — always match clothing to environment:
  - Near beach or outdoor summer: casual summer clothes (linen, light t-shirt, shorts, sundress) — NEVER swimwear
  - Campus or city: smart casual (jeans, sneakers, light jacket)
  - Airport: travel-ready casual with carry-on or suitcase
  - Café/indoor: relaxed smart casual

DESTINATION ANCHORING — always include an iconic, unmistakable landmark for the destination:
  Australia: Sydney Opera House, Harbour Bridge, Bondi promenade, Melbourne laneways.
  Canada: CN Tower, Banff lakes, Vancouver skyline. UK: Big Ben, Tower Bridge, Oxford spires.
  Malta: Valletta limestone streets, Blue Lagoon, Grand Harbour. (Same principle for any other destination.)

- 2:3 aspect ratio composition (portrait)
- No text, logos, watermarks, or overlay elements
- 2–3 sentences per prompt: scene + mood + specific detail that makes it feel real

OUTPUT — valid JSON only, no markdown, no explanation:
{
  "caption": "<overall Instagram caption in Spanish with hashtags>",
  "slides": [
    { "slide": 1, "concept": "<1-line description of this slide's role>", "visual": "<Ideogram prompt in English>" },
    { "slide": 2, "concept": "<1-line description>", "visual": "<Ideogram prompt in English>" },
    { "slide": 3, "concept": "<1-line description>", "visual": "<Ideogram prompt in English>" },
    { "slide": 4, "concept": "<1-line description>", "visual": "<Ideogram prompt in English>" }
  ]
}
`.trim();

/**
 * Generates a full Instagram carousel: Claude writes 4 slide scripts, then
 * Ideogram generates all 4 images in parallel.
 *
 * Handles both the caption and image steps for carousel in a single module call.
 *
 * @param {object} record  Raw Airtable record fields
 * @param {object} ctx     Pipeline context accumulated by prior steps
 * @returns {Promise<object>} { ...ctx, caption, slides }
 *   slides: [{ slide, concept, visual, imageUrl }, ...]
 */
export async function generateCarousel(record, ctx) {
  const pillar   = record['Pilar'];
  const audience = record['Audiencia'];
  const tema     = record['Destino/Tema'];
  const cta      = record['CTA'];

  const userMessage = [
    `Content pillar: ${pillar}`,
    `Target audience: ${audience}`,
    tema ? `Destination / topic: ${tema}` : 'Destination / topic: (choose a compelling example relevant to Colombian students)',
    cta ? `CTA — use this text exactly: "${cta}"` : 'CTA: (choose the most fitting from the pillar defaults in the system prompt)',
  ].join('\n');

  // Step 1: Claude generates caption + 4 slide scripts
  const { caption, slides: slideScripts } = await generateSlideScripts(userMessage);

  // Step 2: Ideogram generates all 4 images in parallel
  const imageUrls = await Promise.all(
    slideScripts.map(slide => generateSlideImage(slide.visual))
  );

  // Merge image URLs into slide objects
  const slides = slideScripts.map((slide, i) => ({
    ...slide,
    imageUrl: imageUrls[i],
  }));

  return { ...ctx, caption, slides };
}

async function generateSlideScripts(userMessage) {
  const message = await withRetry(() =>
    client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    })
  );

  const raw = message.content[0].text.trim();
  const parsed = parseJson(raw);

  if (!parsed.caption || !Array.isArray(parsed.slides) || parsed.slides.length !== 4) {
    throw new Error(`generate-carousel: expected caption + 4 slides, got: ${raw.slice(0, 200)}`);
  }

  for (const slide of parsed.slides) {
    if (!slide.visual) {
      throw new Error(`generate-carousel: slide ${slide.slide} missing visual prompt`);
    }
  }

  return { caption: parsed.caption, slides: parsed.slides };
}

async function generateSlideImage(visualPrompt) {
  return withRetry(async () => {
    const resp = await fetch(IDEOGRAM_URL, {
      method: 'POST',
      headers: {
        'Api-Key':      process.env.IDEOGRAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_request: {
          prompt:              visualPrompt,
          aspect_ratio:        'ASPECT_3_4',
          model:               'V_2',
          style_type:          'REALISTIC',
          magic_prompt_option: 'OFF',
        },
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      const err  = new Error(`Ideogram ${resp.status}: ${body}`);
      err.status = resp.status;
      throw err;
    }

    const json = await resp.json();
    const url  = json?.data?.[0]?.url;
    if (!url) throw new Error(`Ideogram: no image URL in response: ${JSON.stringify(json)}`);
    return url;
  });
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`generate-carousel: unparseable Claude response:\n${raw}`);
    try {
      return JSON.parse(match[0]);
    } catch {
      const repaired = match[0].replace(/"(?:[^"\\]|\\.)*"/gs, s =>
        s.replace(/\n/g, '\\n').replace(/\r/g, '\\r')
      );
      return JSON.parse(repaired);
    }
  }
}
