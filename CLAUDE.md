# GlobeHop International — Instagram Automation

Automated pipeline publishing 4 Instagram posts/week (Mon/Wed/Fri/Sat, 8am Bogotá) for a Colombian international education agency. Content is AI-generated, stored in Airtable for human review, and published after approval. Triggered by Make.com; runs on Railway.

---

## Current Production Scope (June 2026)

- **Active destination:** Australia only — all other destinations set to `Omitir`
- **Active post types:** `single_photo`, `carousel`, and `reel`
- **News posts:** every 2nd week the Saturday single_photo is pillar `news_update` — grounded in current news via web search (see Content Variety System)
- **Reels:** active — Kling v2-1 pro, 4 scenes × 5s = 20s, quality validated
- **Approval flow:** marketing team uses the web review dashboard (see below)

---

## Tech Stack

| Layer | Tool |
|---|---|
| Runtime | Node.js 20+ ESM — all files use `import`/`export` |
| AI content | Claude API `claude-sonnet-4-6` — captions, hooks, 4-scene reel prompts (Spanish) |
| AI images | Ideogram API v3 — photos and carousel slides (`V_3` model, REALISTIC style) |
| AI video | Kling API (`api.klingai.com`) — image-to-video for reels (paused) |
| Image processing | Sharp — logo overlay on generated images |
| Data / approval | Airtable REST — content calendar + `Estado` state machine |
| Scheduling | Make.com — triggers `/generate-next` 1×/week (Monday; one call generates all 4 posts) |
| Publishing | Instagram Graph API v21.0 — photo, carousel, reel |
| Hosting | Railway — webhook server + temporary image serving |
| CDN | Cloudinary — permanent image/video storage |
| Email | SendGrid — error alerts + publish confirmations |

---

## Key Directories

```
instagram-automation/
├── src/
│   ├── pipeline.js              Pipeline runner — orchestrates all generation steps
│   ├── webhook.js               Express server — all HTTP endpoints (see Endpoints section)
│   ├── generate-content.js      Claude API — caption + hook + visual prompt (single_photo/reel)
│   ├── generate-carousel.js     Claude API — 6-slide carousel content + imagePrompts
│   ├── generate-image.js        Ideogram V_3 — single image (single_photo, reel scenes)
│   ├── generate-reel.js         Kling API — image-to-video with async polling
│   ├── apply-brand.js           Sharp — logo + hook overlay for single_photo; overlay PNGs for video
│   ├── apply-brand-video.js     FFmpeg — multi-scene assembly, per-scene overlays, music mix
│   ├── humanize-caption.js      Claude API — rewrite pass to remove AI-ness from caption
│   ├── render-carousel.js       Puppeteer — render 6 branded slide PNGs, upload to Cloudinary
│   ├── upload-cdn.js            Cloudinary — permanent URL for videos and branded images
│   ├── save-to-airtable.js      Airtable REST — step persistence + Estado state machine
│   ├── post-to-instagram.js     Instagram Graph API — photo + carousel publish
│   ├── post-reel.js             Instagram Graph API — reel publish with container polling
│   ├── send-alert.js            SendGrid — error alerts + publish confirmations
│   └── utils/
│       ├── retry.js             Shared exponential backoff wrapper
│       ├── characters.js        Colombian character library — 11 profiles, selectCharacter()
│       ├── fetch-guard.js       SSRF allowlist — assertAllowedUrl() for all external fetches
│       ├── australia-locations.js  City/landmark rotation for Australia CITY LOCK
│       └── parse-json.js        Robust JSON extraction from Claude responses
├── scripts/
│   ├── setup-airtable.js        One-time: create schema only (no seeding)
│   ├── reset-airtable.js        Clear all records + seed fresh 4-week calendar
│   ├── focus-australia.js       Migration: marks all reel + non-Australia records as Omitir
│   ├── migrate-destino-field.js Schema migration helper
│   ├── test-generate.js         Integration test: full generation pipeline
│   └── test-post.js             Integration test: publish an approved record to Instagram
└── assets/
    ├── logo-no-bg.png            Team-provided; never committed
    ├── icon-no-bg.png            Team-provided; never committed
    └── music/                    Royalty-free MP3/M4A/AAC tracks — picked randomly per reel
```

---

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | none | Uptime check |
| POST | `/generate-next` | `X-Webhook-Secret` | Find today's En cola record and run pipeline |
| POST | `/generate` | `X-Webhook-Secret` | Run pipeline for a specific `recordId` |
| POST | `/publish` | `X-Webhook-Secret` | Publish an Aprobado record to Instagram (manual, ignores date) |
| POST | `/publish-scheduled` | `X-Webhook-Secret` | Publish all Aprobado records due today or earlier (Make.com Mon/Wed/Fri/Sat 8am Bogotá) |
| GET | `/retry/:recordId` | HMAC token (email link) | Resume a failed pipeline |
| **GET** | **`/review`** | **`?token=REVIEW_PASSWORD`** | **Marketing team dashboard** |
| **GET** | **`/review/:recordId`** | **`?token=REVIEW_PASSWORD`** | **Full post preview** |
| **POST** | **`/review/:recordId/approve`** | **form body `reviewToken`** | **Mark Aprobado (publishes immediately if the date already passed)** |
| **POST** | **`/review/:recordId/reject`** | **form body `reviewToken`** | **Mark Omitir** |

**Airtable date filter pitfall:** never compare `{Fecha publicación}` directly against a `'YYYY-MM-DD'` string — the comparison fails on the equality day (the field renders as a full datetime). Always wrap: `DATETIME_FORMAT({Fecha publicación}, 'YYYY-MM-DD') <= '...'`.
| GET | `/images/:filename` | none (rate-limited) | Serve branded images from /tmp |

### Web Review Dashboard (marketing team)

URL: `https://<RAILWAY_URL>/review?token=<REVIEW_PASSWORD>`

Flow:
1. Make.com triggers `/generate-next` → pipeline runs → Airtable: `Pendiente revisión`
2. SendGrid alert email sent with link to dashboard
3. Team opens the dashboard URL (bookmark it)
4. Click a post card → full preview (image/carousel/caption/hook)
5. **Aprobar** → Estado: `Aprobado` → `/publish-scheduled` posts it at 8am Bogotá on its date. If the date already passed, the approve handler publishes immediately in the background.
6. **Rechazar** → Estado: `Omitir` (removed from queue)

---

## Essential Commands

```bash
# One-time: create Airtable table schema (does not seed records)
node scripts/setup-airtable.js

# Reset: delete all records + seed fresh 4-week calendar
node scripts/reset-airtable.js

# Focus: mark all reel + non-Australia records as Omitir (run once after reset)
node scripts/focus-australia.js

# Integration test: full generation pipeline (single_photo, carousel, or reel)
node scripts/test-generate.js

# Integration test: publish an approved Airtable record to Instagram
node scripts/test-post.js

# Start server (production and local dev)
node src/webhook.js

# Trigger generation for next queued record (requires server running)
curl -X POST http://localhost:3000/generate-next \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET"

# Health check
curl http://localhost:3000/health
```

---

## Environment Variables

Required on Railway:

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `IDEOGRAM_API_KEY` | Ideogram API key |
| `KLING_API_KEY` | Kling API key (paused — keep for when reels resume) |
| `KLING_API_SECRET` | Kling API secret |
| `AIRTABLE_API_KEY` | Airtable personal access token |
| `AIRTABLE_BASE_ID` | Airtable base ID (appXXXXXXXXXXXXXX) |
| `AIRTABLE_TABLE_NAME` | Table name (default: `Contenido Instagram`) |
| `INSTAGRAM_ACCOUNT_ID` | Instagram business account ID |
| `INSTAGRAM_SYSTEM_USER_TOKEN` | Instagram Graph API long-lived token |
| `WEBHOOK_SECRET` | Shared secret for Make.com → Railway webhook calls |
| `RAILWAY_PUBLIC_URL` | Public URL of Railway service (e.g. `https://globehop.up.railway.app`) |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `SENDGRID_API_KEY` | SendGrid API key for error alerts |
| `ALERT_EMAIL` | Email address to receive error alerts |
| **`REVIEW_PASSWORD`** | **Password for the marketing team review dashboard** |

---

## Estado State Machine

```
En cola → (pipeline) → Pendiente revisión → (Aprobar) → Aprobado → (publish) → Publicado
                                          → (Rechazar) → Omitir
                     → (error) → Error → (retry) → En cola
```

---

## Guard Rails

- `.env` is never committed — all secrets via environment variables only
- Airtable records are never deleted mid-pipeline — only `Estado` is updated. Exception: `reset-airtable.js` is the designated reset tool and intentionally deletes all records before reseeding.
- `WEBHOOK_SECRET` is validated before processing any webhook request using HMAC-normalised constant-time comparison (prevents timing oracle attacks)
- `/publish` only executes if `Estado === 'Aprobado'`; `/review/:id/approve` publishes directly from `Pendiente revisión`
- All external URLs fetched by the pipeline (Ideogram, Kling, Cloudinary) are validated against an allowlist in `utils/fetch-guard.js` before the HTTP request is made (SSRF protection)
- Stop and ask before: Airtable schema changes, webhook URL changes, Instagram API version changes

---

## Image Quality Notes

- Ideogram model: `V_3` via endpoint `https://api.ideogram.ai/v1/ideogram-v3/generate` — both `generate-image.js` and `render-carousel.js`
- Aspect ratio format: `'3x4'`, `'9x16'` etc. (V3 uses ratio strings, not `ASPECT_*` tokens)
- `negative_prompt` on all Ideogram calls blocks: plastic skin, stock-photo look, text overlay, **dark sky, stormy sky, night scene, overcast grey sky** — images must always show clear blue sky, sunshine, or warm sunrise light
- `magic_prompt_option: 'OFF'` — preserves exact documentary-style prompts from Claude
- Carousel backgrounds: all 6 slides generated in parallel via Ideogram before Puppeteer renders
- Single photo: Sharp applies logo + hook overlay after Ideogram generation

---

## Content Visual Style

### Overlay Opacity Values
Keeping these values documented so review feedback can be addressed with targeted adjustments:

| Surface | Location | Current opacity |
|---|---|---|
| Single photo / reel gradient (bottom) | `apply-brand.js` `gradMaxOpa` | `0.72` (reel), `0.52` (photo) |
| Simple scene text gradient (bottom) | `apply-brand.js` `createSimpleTextPng` | `0.50` |
| Carousel hook slide | `render-carousel.js` `hookHtml` | `0.32` |
| Carousel statement slide | `render-carousel.js` `statementHtml` | `0.30` |
| Carousel list slide | `render-carousel.js` `listHtml` | `0.35` |
| Carousel fact slide | `render-carousel.js` `factHtml` | `0.33` |
| Carousel CTA slide | `render-carousel.js` `ctaHtml` | `0.45` |

### Logo / Icon
- GlobeHop icon on reels and video overlays: `width * 0.165` (≈ 178px on 1080px frame) — top-left, 20px from left, 48px from top

### Sky and Weather Rules
All image prompts must produce **clear blue sky, bright sunshine, or warm sunrise**. Dark skies, stormy weather, heavy overcast, and night scenes are blocked via `negative_prompt` in both `generate-image.js` and `render-carousel.js`, and the `generate-content.js` system prompt explicitly prohibits them.

---

## Colombian Character Library

Character profiles are defined in `src/utils/characters.js`. Full profiles are sourced from `Review/GlobeHop_Character_Library.md`. They are injected into image prompts only (not captions or hooks) via a `CHARACTER LOCK` block in the Claude user message.

**Selection logic (`selectCharacter(record, pillar)`):**
- `record.id` is set explicitly in `pipeline.js` (`record.id = recordId`) because `fetchRecord()` returns only fields (no `.id`). This must be present for gender alternation to work.
- Gender alternates deterministically per Airtable record ID (charSum % 2) — roughly 50/50 across posts
- Pillar maps to a character pool:
  - `destination_spotlight` → lifestyle profiles (indices 0–2)
  - `student_story` → relatable profiles (indices 0, 5 female / 0, 4 male)
  - `visa_tip` → approachable profiles (indices 1, 5 female / 1, 4 male)
  - `agency_promo` → professional profiles (indices 3, 0)
- 6 female profiles + 5 male profiles = 11 total
- **No city or region of origin is included in any prompt** — appearance descriptors only
- Each profile includes photography style anchors (`authentic Colombian appearance`, `documentary photography`, `natural skin texture`, etc.) to prevent Ideogram from rendering generic AI faces

Both `generate-content.js` (single_photo/reel) and `generate-carousel.js` use `selectCharacter()`.

---

## Kling Video Quality Notes

- Model: `kling-v2-1`, mode: `pro`, duration: `5s`, `cfg_scale: 0.5`
- Positive motion prompt includes: *"Realistic human movement, natural physics, high realism, authentic movement, no exaggerated facial expressions. CAMERA FULLY LOCKED."*
- Negative prompt blocks: warped fingers, facial drift, expression morphing, camera shake, **talking, laughing mouth, dramatic movement, exaggerated expressions, fast motion, animated gestures**
- See `src/generate-reel.js` `motionPrompt()` and `NEGATIVE_PROMPT` constants for full values

---

## Australia Location Selection

Defined in `src/utils/australia-locations.js`. 22 locations across Melbourne, Brisbane, Perth, Adelaide, Gold Coast, Cairns, Sydney, Hobart, Darwin, and Kangaroo Island.

**Selection logic (`pickAustraliaLocation(record)`):**
- Deterministic from the record's `Fecha publicación`: week Monday hash + day slot (Mon/Wed/Fri/Sat → 0–3), slots spaced 5 indexes apart — the 4 posts of any week always land in **4 different cities**, and the set rotates week over week
- Same record always maps to the same location (idempotent retries work correctly); no in-memory state, deploy-restart safe
- Falls back to a record-ID hash if the record has no publish date
- Three locations are tagged `type: 'wildlife'` (Lone Pine koala, Rottnest quokka, Kangaroo Island kangaroos)
- Wildlife locations trigger a `WILDLIFE SCENE DIRECTIVE` in the Claude user message that makes the animal the primary visual subject and places the student character in the mid-ground

Pass the full record (fields + `.id`) — see pipeline.js note above.

---

## Content Variety System

Defined in `src/utils/variety.js`. All picks are deterministic (idempotent retries) and salted independently so location, character, topic, and scene never correlate.

- **Topic bank (`pickTopic(record, pillar)`):** 16 specific angles per pillar. Index = pillar hash + Monday-anchored week counter → the same pillar cycles through all 16 angles before repeating (16 weeks). Injected as `TOPIC LOCK` (generate-content) / `ÁNGULO ESPECÍFICO` (generate-carousel).
- **Scene archetypes (`pickSceneArchetype(record)`):** 10 visual archetypes rotated per record, injected as `SCENE ARCHETYPE LOCK` for single_photo posts.
- **Shared hash (`hashStr`):** FNV-1a — replaces the old character-sum hash whose collisions produced posts with identical city + character pairs.

### News posts (`news_update` pillar)

`src/generate-news.js` runs a research phase before generation using the Anthropic `web_search` server tool:
- Finds one story from the last ~14 days relevant to Colombian students/parents (visa policy, intakes, scholarships, work rules, cost of living, safety)
- **Hybrid sourcing:** if the team pastes an article URL into the record's `Notas` field before generation, that story is used instead of searching
- The story is injected into `generate-content.js` as a `NEWS LOCK`; the caption mentions the source naturally, never copies money figures (the `check` step blocks them), and always redirects to GlobeHop for exact details
- The covered story is written back to `Notas` as `[news] headline — url`; `fetchRecentNewsStories()` feeds these into future runs so stories don't repeat
- If no relevant story is found, the post falls back to the `visa_tip` topic bank
- Seeding: `reset-airtable.js` marks every 2nd-week Saturday as `news_update`; the Pilar single-select option was created via `typecast: true` (the Meta API cannot edit select choices)

### Curated reference sources (`src/utils/sources.js`)

Team-maintained list at `docs/latam_students_australia_sources.md` (official Australian government stats, university/testimonial pages, news coverage) — parsed once at module load into `getSourcesReferenceBlock()`. Team edits the markdown; no code change or redeploy needed for the content to take effect on the next process restart.
- `generate-news.js`: injected into the system prompt as "KNOWN RELIABLE SOURCES" — Claude prioritizes/cross-checks these before general web search when researching a `news_update` story
- `generate-content.js`: injected as an optional "REFERENCE SOURCES" block for `destination_spotlight`, `student_story`, and `agency_promo` pillars only (never `visa_tip`, which already forbids stating specifics as fact; never `news_update`, which has its own dedicated NEWS LOCK) — Claude may ground one detail if it fits the TOPIC LOCK angle, must paraphrase (no URLs, no exact figures), and must never represent the Maria-from-Colombia story or YouTube testimonial video as an actual GlobeHop client
- Returns `''` if the doc is missing/unparsable — grounding is optional, never blocks generation

---

## Additional Documentation

| Topic | File |
|---|---|
| Pipeline patterns, retry logic, step contracts | `.claude/docs/architectural_patterns.md` |
| Airtable schema + Estado state machine | `docs/superpowers/specs/2026-06-03-instagram-automation-design.md:61-92` |
| Content system: post types, pillars, audiences, CTAs | `docs/superpowers/specs/2026-06-03-instagram-automation-design.md:96-130` |
| Webhook endpoints + Instagram publishing flows | `docs/superpowers/specs/2026-06-03-instagram-automation-design.md:134-165` |
| Video quality improvement guidelines | `Review/GlobeHop_Video_Changes.md` |
| Character profiles reference | `Review/GlobeHop_Character_Library.md` |
| Curated LatAm→Australia source list | `docs/latam_students_australia_sources.md` |
