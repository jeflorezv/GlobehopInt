# GlobeHop International — Instagram Automation

Automated pipeline publishing 4 Instagram posts/week (Mon/Wed/Fri/Sat, 8am Bogotá) for a Colombian international education agency. Content is AI-generated, stored in Airtable for human review, and published after approval. Triggered by Make.com; runs on Railway.

---

## Current Production Scope (June 2026)

- **Active destination:** Australia only — all other destinations set to `Omitir`
- **Active post types:** `single_photo`, `carousel`, and `reel`
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
| POST | `/publish` | `X-Webhook-Secret` | Publish an Aprobado record to Instagram |
| GET | `/retry/:recordId` | HMAC token (email link) | Resume a failed pipeline |
| **GET** | **`/review`** | **`?token=REVIEW_PASSWORD`** | **Marketing team dashboard** |
| **GET** | **`/review/:recordId`** | **`?token=REVIEW_PASSWORD`** | **Full post preview** |
| **POST** | **`/review/:recordId/approve`** | **form body `reviewToken`** | **Publish + mark Publicado** |
| **POST** | **`/review/:recordId/reject`** | **form body `reviewToken`** | **Mark Omitir** |
| GET | `/images/:filename` | none (rate-limited) | Serve branded images from /tmp |

### Web Review Dashboard (marketing team)

URL: `https://<RAILWAY_URL>/review?token=<REVIEW_PASSWORD>`

Flow:
1. Make.com triggers `/generate-next` → pipeline runs → Airtable: `Pendiente revisión`
2. SendGrid alert email sent with link to dashboard
3. Team opens the dashboard URL (bookmark it)
4. Click a post card → full preview (image/carousel/caption/hook)
5. **Aprobar y Publicar** → posts immediately to Instagram → Estado: `Publicado`
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

**Selection logic (`pickAustraliaLocation(recordId)`):**
- Deterministic hash of the Airtable record ID (`charSum % 22`) — no in-memory state, deploy-restart safe
- Same record always maps to the same location (idempotent retries work correctly)
- Different record IDs spread naturally across all 22 locations
- Three locations are tagged `type: 'wildlife'` (Lone Pine koala, Rottnest quokka, Kangaroo Island kangaroos)
- Wildlife locations trigger a `WILDLIFE SCENE DIRECTIVE` in the Claude user message that makes the animal the primary visual subject and places the student character in the mid-ground

`record.id` must be set before calling `pickAustraliaLocation(record.id)` — see pipeline.js note above.

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
