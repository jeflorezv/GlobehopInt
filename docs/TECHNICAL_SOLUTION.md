# GlobeHop Instagram Automation — Technical Solution Document

**Version:** 1.0.4  
**Last updated:** June 2026  
**Maintainer:** jeflorez@gmail.com

---

## Overview

An automated pipeline that generates, reviews, and publishes 4 Instagram posts per week for GlobeHop International. Content is AI-generated, stored in Airtable for human review, and published after approval via a web dashboard.

**Trigger:** Make.com scheduled webhook → Railway Express server → AI generation pipeline → Airtable review queue → marketing team approves → Instagram Graph API

---

## Architecture

```
Make.com (scheduler)
    │
    ▼ POST /generate-next (X-Webhook-Secret)
Railway Express Server (src/webhook.js)
    │
    ▼
pipeline.js (orchestrator)
    ├── generate-content.js  or  generate-carousel.js
    │       └── Claude API (claude-sonnet-4-6)
    ├── humanize-caption.js
    │       └── Claude API
    ├── generate-image.js  (single_photo)
    │       └── Ideogram API (V_3, REALISTIC)
    │   OR render-carousel.js  (carousel)
    │       ├── generate-image.js ×6 (parallel)
    │       └── Puppeteer (slide rendering)
    ├── apply-brand.js (Sharp — logo + hook overlay)
    ├── upload-cdn.js
    │       └── Cloudinary
    └── save-to-airtable.js
            └── Airtable REST API

Estado: Pendiente revisión
    │
    ▼
Marketing team → /review dashboard (webhook.js)
    │  Approve → post-to-instagram.js → Instagram Graph API v21.0
    │  Reject  → Estado: Omitir
    ▼
Estado: Publicado
```

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js ESM | ≥20 |
| Web framework | Express.js | ^4.19 |
| AI captions | Anthropic Claude | claude-sonnet-4-6 |
| AI images | Ideogram API | V_3, REALISTIC |
| AI video (paused) | Kling AI | api.klingai.com |
| Image processing | Sharp | ^0.33 |
| Carousel rendering | Puppeteer | ^25.1 |
| CMS / state machine | Airtable REST | v0 |
| CDN | Cloudinary | SDK v2 |
| Publishing | Instagram Graph API | v21.0 |
| Hosting | Railway | nixpacks |
| Scheduler | Make.com | — |
| Email alerts | SendGrid | ^8.1 |

---

## Repository Structure

```
/
├── src/
│   ├── webhook.js            Express server — all HTTP endpoints
│   ├── pipeline.js           Pipeline orchestrator with resume support
│   ├── generate-content.js   Claude — caption + hook + visual prompt (single_photo)
│   ├── generate-carousel.js  Claude — 6-slide carousel content + imagePrompts
│   ├── generate-image.js     Ideogram V_3 — single image generation
│   ├── generate-reel.js      Kling — image-to-video (paused)
│   ├── apply-brand.js        Sharp — logo + hook overlay for single_photo
│   ├── apply-brand-video.js  FFmpeg — multi-scene video assembly (paused)
│   ├── humanize-caption.js   Claude — anti-AI-ness rewrite pass
│   ├── render-carousel.js    Puppeteer — 6 branded slide PNGs → Cloudinary
│   ├── upload-cdn.js         Cloudinary — permanent URL storage
│   ├── save-to-airtable.js   Airtable REST — step persistence + state machine
│   ├── post-to-instagram.js  Instagram Graph API — photo + carousel publish
│   ├── post-reel.js          Instagram Graph API — reel publish (paused)
│   ├── send-alert.js         SendGrid — error alerts + publish confirmations
│   └── utils/
│       ├── retry.js          Exponential backoff wrapper
│       ├── parse-json.js     Robust JSON extractor for Claude responses
│       └── australia-locations.js  Location picker with repetition prevention
├── scripts/
│   ├── setup-airtable.js     One-time schema creation
│   ├── reset-airtable.js     Delete all records + seed 4-week calendar
│   ├── focus-australia.js    Mark non-Australia records as Omitir
│   ├── test-generate.js      Integration test: full pipeline
│   └── test-post.js          Integration test: publish to Instagram
├── assets/
│   ├── fonts/                Nexa-Heavy.ttf, Nexa-ExtraLight.ttf, Poppins-Bold.ttf
│   └── logo-no-bg.png        GlobeHop logo (transparent PNG)
├── docs/
│   ├── GUIA_EQUIPO_MARKETING.md   Marketing team user guide (Spanish)
│   └── TECHNICAL_SOLUTION.md     This document
├── nixpacks.toml             Railway build config
├── railway.json              Railway service config
└── .railwayignore            Files excluded from Railway deployment
```

---

## HTTP Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | none | Uptime check |
| POST | `/generate-next` | `X-Webhook-Secret` header | Pick next En cola record and run pipeline |
| POST | `/generate` | `X-Webhook-Secret` header | Run pipeline for a specific `recordId` |
| POST | `/publish` | `X-Webhook-Secret` header | Publish an Aprobado record to Instagram |
| GET | `/retry/:recordId` | HMAC token (email link) | Resume a failed pipeline from last completed step |
| GET | `/review` | `?token=REVIEW_PASSWORD` | Marketing team dashboard |
| GET | `/review/:recordId` | `?token=REVIEW_PASSWORD` | Full post preview (image + caption + hook) |
| POST | `/review/:recordId/save-edits` | form body `reviewToken` | Save edited hook/caption to Airtable |
| POST | `/review/:recordId/approve` | form body `reviewToken` | Publish + mark Publicado |
| POST | `/review/:recordId/reject` | form body `reviewToken` | Mark Omitir |
| GET | `/images/:filename` | none | Serve branded images from /tmp |

---

## Estado State Machine

```
En cola
  │
  ▼ /generate-next or /generate
  Generando... (transient, pipeline running)
  │
  ├─── success ──▶  Pendiente revisión  ──▶  [/review dashboard]
  │                        │
  │                        ├── Aprobar  ──▶  Publicado
  │                        └── Rechazar ──▶  Omitir
  │
  └─── error ────▶  Error  ──▶  [retry email link]
                      │
                      └─────▶  En cola  (manual or /retry)
```

---

## Pipeline Steps by Post Type

### single_photo
1. `caption` — Claude generates caption + hook + Ideogram visual prompt
2. `humanize` — Claude rewrites caption to remove AI-ness
3. `image` — Ideogram V_3 generates 1080×1350 REALISTIC image
4. `brand` — Sharp overlays logo (bottom-right) + hook text (top)
5. `save` — Upload to Cloudinary, set Estado=Pendiente revisión

### carousel
1. `caption` — Claude generates caption + 6 slide objects with layout + imagePrompts
2. `humanize` — Claude rewrites caption
3. `render` — 6 Ideogram images generated in parallel; Puppeteer renders branded slides at 1080×1350px; uploaded to Cloudinary
4. `save` — Set Estado=Pendiente revisión

### reel (paused — Kling artifacts not production-ready)
1. `caption` — Claude generates caption + 4-scene reel script with visual prompts
2. `humanize` — Claude rewrites caption
3. `images` — 4 Ideogram images in parallel (one per scene)
4. `video` — Images uploaded to Cloudinary; Kling generates clips; FFmpeg assembles + adds music + overlays
5. `save` — Set Estado=Pendiente revisión

---

## Resume Logic

Each pipeline step persists its output to Airtable immediately. If a step fails, the next invocation (via `/retry/:recordId`) reads `Paso completado` from Airtable and skips already-completed steps. This prevents re-billing AI APIs for steps that succeeded.

---

## Australia Location Diversity

`src/utils/australia-locations.js` — 22 location entries across 10 Australian cities and regions. A shared singleton tracks the last 7 picks so no location repeats within a week's worth of posts.

Both `generate-content.js` and `generate-carousel.js` import `pickAustraliaLocation()` and inject a **CITY LOCK** block into the Claude user message when the destination is Australia. This overrides Claude's default bias toward Sydney Opera House / Harbour Bridge.

Covered locations: Melbourne (4), Brisbane (3), Perth (3), Adelaide (2), Gold Coast (2), Cairns (2), Sydney/Blue Mountains (3, Opera House excluded), Hobart (1), Darwin (1), Kangaroo Island (1).

---

## Carousel Rendering (render-carousel.js)

Puppeteer renders slides at 1080×1350px using inline HTML/CSS with brand tokens:

| Token | Value |
|-------|-------|
| Dark Blue | `#1C2631` |
| Blue | `#44539D` |
| Mint | `#67BB97` |

**5 slide layouts:**
- `hook` — large headline, optional subtext, full-bleed background image (Slide 1)
- `statement` — bold headline, optional body copy, optional Mint tag label
- `list` — headline + 3–4 bullet items (uses ✖ for errors, ✓ for solutions)
- `fact` — large stat number, stat label, optional headline and body
- `cta` — question headline, keyword in large text, action verb, offer line, save prompt (Slide 6)

Custom fonts loaded at module startup: Nexa Heavy, Nexa ExtraLight, Poppins Bold.

---

## Image Generation (generate-image.js)

All images go through Ideogram API with these fixed parameters:

```javascript
model: 'V_3'
style_type: 'REALISTIC'
magic_prompt_option: 'OFF'      // preserves exact documentary prompts
aspect_ratio: 'ASPECT_3_4'     // 1080×1350 Instagram portrait
negative_prompt: [
  'plastic skin', 'stock photo aesthetic', 'CGI', 'heavy bokeh',
  'text overlay', 'logo', 'watermark', 'ultra smooth skin',
  'beauty photography', 'AI-looking'
]
```

`magic_prompt_option: 'OFF'` is critical — it prevents Ideogram from rewriting Claude's detailed documentary-style prompts into generic stock photo descriptions.

---

## Airtable Schema

**Table:** `Contenido Instagram`

| Field | Type | Purpose |
|-------|------|---------|
| Destino/Tema | Text | Destination (e.g. "Australia") |
| Tipo de post | Select | `single_photo`, `carousel`, `reel` |
| Pilar | Select | Content pillar |
| Audiencia | Select | Target audience |
| CTA | Select | Call to action type |
| Estado | Select | State machine field |
| Paso completado | Text | Last successful pipeline step |
| Caption generado | Long text | AI-generated caption |
| Hook | Text | Hook text (3 lines, displayed on image) |
| Descripción visual | Long text | Ideogram visual prompt (single_photo) |
| URL imagen | URL | Raw Ideogram image URL |
| URL imagen branded | URL | Final Cloudinary URL (with logo overlay) |
| Slides JSON | Long text | JSON array of slide objects (carousel/reel) |
| Imagen preview | Attachment | Airtable attachment preview |
| URL Video | URL | Cloudinary video URL (reels) |
| Fecha programada | Date | Scheduled publish date |
| Error mensaje | Text | Error details if Estado=Error |

---

## Environment Variables

All secrets are set as Railway service variables. Never committed to git.

| Variable | Service |
|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic Claude |
| `IDEOGRAM_API_KEY` | Ideogram |
| `KLING_API_KEY` | Kling AI (paused) |
| `KLING_API_SECRET` | Kling AI (paused) |
| `AIRTABLE_API_KEY` | Airtable |
| `AIRTABLE_BASE_ID` | Airtable |
| `AIRTABLE_TABLE_NAME` | Airtable |
| `INSTAGRAM_ACCOUNT_ID` | Instagram Graph API |
| `INSTAGRAM_SYSTEM_USER_TOKEN` | Instagram Graph API |
| `WEBHOOK_SECRET` | Make.com → Railway auth |
| `RAILWAY_PUBLIC_URL` | Railway (auto-set) |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary |
| `CLOUDINARY_API_KEY` | Cloudinary |
| `CLOUDINARY_API_SECRET` | Cloudinary |
| `SENDGRID_API_KEY` | SendGrid |
| `ALERT_EMAIL` | SendGrid |
| `REVIEW_PASSWORD` | Review dashboard auth |

---

## Deployment

**Platform:** Railway (nixpacks build, Node.js 20)

**Key deployment notes:**
- `assets/fonts/` MUST be included — `render-carousel.js` loads fonts at startup
- `Review/` directory MUST be excluded (contains large video files with macOS extended attributes)
- Bump `package.json` version before each deploy to prevent Railway image cache reuse
- Production URL: `https://globehop-instagram-production.up.railway.app`

**Deploy process:**
```bash
# 1. Sync to clean temp directory (excludes Review/)
rsync -av --exclude='Review/' --exclude='node_modules/' \
  /Users/julian/Claude/GlobeHop_International/ /tmp/gh-deploy/

# 2. Verify fonts are included, .railwayignore has no assets/fonts line
# 3. Bump version in package.json
# 4. Deploy
cd /tmp/gh-deploy && railway up --service globehop-instagram
```

---

## Security

- `WEBHOOK_SECRET` validated via HMAC on all webhook endpoints
- `/review` dashboard protected by `REVIEW_PASSWORD` token in query string
- Retry links use time-windowed HMAC tokens (2-hour window, keyed by `WEBHOOK_SECRET`)
- All secrets in Railway environment variables, never in source code
- Rate limiting on Express endpoints via `express-rate-limit`

---

## Error Handling

1. Any pipeline step failure triggers `markError(recordId)` — sets `Estado=Error` and saves the error message
2. `sendErrorAlert()` sends a SendGrid email with the error details and a retry link
3. The retry link calls `/retry/:recordId?token=<HMAC>` — this resets Estado to En cola and re-runs the pipeline from the last successful step
4. All external API calls are wrapped in `withRetry()` — exponential backoff with 3 attempts

---

## Content System

### Post Types (active)
- `single_photo` — one Ideogram image + Sharp-branded overlay
- `carousel` — 6 Puppeteer-rendered slides with Ideogram backgrounds

### Post Types (paused)
- `reel` — Kling video generation paused due to hand/face artifacts

### Content Pillars
Destination spotlight, student story, parent content, visa tips, agency promo, professionals

### Audiences
Jóvenes colombianos 18-30, padres, adultos, profesionales

### Posting Schedule
Mon / Wed / Fri / Sat at 08:00 Bogotá time (UTC-5)

---

## Active Production Scope (June 2026)

- **Destination:** Australia only — all other destinations set to Omitir
- **Post types:** `single_photo` and `carousel` only
- **Reels:** paused
- **Volume:** 4 posts/week

---

## Known Limitations

| Limitation | Mitigation |
|-----------|------------|
| Ideogram images are non-deterministic | CITY LOCK + negative_prompt + magic_prompt OFF reduce variance |
| Kling video has hand/face artifacts | Reels paused until quality improves |
| No automated publishing — requires manual approval | Intentional design; marketing team approves each post |
| Railway image serving from /tmp | Branded images uploaded to Cloudinary for persistence |
| Australia location memory resets on server restart | Acceptable — Railway restarts are infrequent |

---

## Operational Runbook

### Add new posts to calendar
```bash
node scripts/reset-airtable.js    # clears and reseeds 4-week calendar
node scripts/focus-australia.js   # marks non-Australia records as Omitir
```

### Trigger a post manually
```bash
curl -X POST https://globehop-instagram-production.up.railway.app/generate-next \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET"
```

### Check server logs
```bash
railway logs --service globehop-instagram
```

### Resume a failed post
Open the retry link from the error alert email, or:
```bash
curl -X POST https://globehop-instagram-production.up.railway.app/generate \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"recordId": "recXXXXXXXXXXXXXX"}'
```
