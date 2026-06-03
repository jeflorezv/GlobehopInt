# Design: Instagram Automation — GlobeHop International

> Date: 2026-06-03
> Status: Approved for implementation

---

## Overview

Automated pipeline that publishes 4 Instagram posts per week for a Colombian international education agency. Posts are generated with AI (captions, images, video), stored in Airtable for human review, and published after approval. The system is triggered by Make.com and runs on Railway.

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Make.com → Webhook interface | Make.com queries Airtable, passes `recordId` | Simpler server; Make.com handles "no record today" gracefully |
| Airtable setup | Schema + 4-week calendar pre-population | Rotation schedule auto-generated; team fills in Destino/Tema and CTA |
| Error handling | Estado=Error + email + `/retry/:recordId` | Team can re-trigger a specific failed record without touching Make.com |
| Pipeline architecture | Named-step runner, resumes from last completed step | No extra dependencies; enables granular retry on failure |
| Code location | `instagram-automation/` subdirectory | Docs and code co-located in same repo, cleanly separated |

---

## File Structure

```
GlobeHop_International/
├── CLAUDE.md
├── plan_automatizacion_instagram.md
├── docs/
│   └── superpowers/specs/
│       └── 2026-06-03-instagram-automation-design.md
└── instagram-automation/
    ├── .env                        ← never commit
    ├── .env.example
    ├── package.json                ← Node.js 20+ ESM
    ├── assets/
    │   └── logo.png                ← provided by team
    ├── src/
    │   ├── pipeline.js             ← pipeline runner (orchestration)
    │   ├── generate-content.js     ← Claude API: captions + hashtags
    │   ├── generate-image.js       ← Ideogram: single image (4:5 or 9:16)
    │   ├── generate-carousel.js    ← Ideogram ×4 + Claude JSON parsing
    │   ├── generate-reel.js        ← Kling API async image-to-video
    │   ├── apply-brand.js          ← Sharp: logo overlay southeast
    │   ├── save-to-airtable.js     ← Airtable REST: update record fields
    │   ├── post-to-instagram.js    ← Graph API: single_photo + carousel
    │   ├── post-reel.js            ← Graph API: video upload + reel publish
    │   ├── send-alert.js           ← SendGrid: success + error emails
    │   └── webhook.js              ← Express server: all endpoints
    └── scripts/
        ├── setup-airtable.js       ← create schema + 4-week calendar
        ├── test-generate.js        ← dry-run full pipeline
        └── test-post.js            ← post existing Airtable draft to Instagram
```

---

## Airtable Schema

**Table:** `Contenido Instagram`

| Field | Type | Values / Notes |
|---|---|---|
| ID | Autonumber | |
| Fecha publicación | Date | |
| Día | Single select | Lunes / Miércoles / Viernes / Sábado |
| Tipo de post | Single select | single_photo / carousel / reel |
| Pilar | Single select | destination_spotlight / visa_tip / student_story / agency_promo |
| Audiencia | Single select | estudiantes_secundaria / universitarios / padres / profesionales / adultos |
| Destino/Tema | Short text | Left blank by setup script — team fills in |
| CTA | Single select | 5 options (see below) |
| Estado | Single select | En cola → Pendiente revisión → Aprobado → Publicado → Omitir → Error |
| Caption generado | Long text | |
| URL imagen | URL | Hero image (photos and reel frame) |
| Slides JSON | Long text | JSON with scripts + images for carousel |
| URL Video | URL | Kling output video for reels |
| Descripción visual | Short text | Ideogram prompt used |
| Paso completado | Short text | Last pipeline step saved (for retry resume) |
| URL post publicado | URL | Instagram permalink |
| Notas | Long text | Internal team use |

**CTA options (exact strings):**
- "Agenda tu consultoría gratuita"
- "Escríbenos por DM"
- "Link en bio"
- "Comenta abajo"
- "Visita nuestro sitio web"

**Airtable automation:** when Estado = "Aprobado" → POST `[WEBHOOK_URL]/publish` with `{ "recordId": "recXXX" }`.

---

## 4-Week Content Rotation (setup-airtable.js)

The setup script generates records for the next 4 weeks starting from the next Monday after the script runs. Records follow this rotation by week number (1-indexed, cycling every 4 weeks):

| Semana | Lunes (single_photo) | Miércoles (carousel) | Viernes (reel) | Sábado (single_photo) |
|---|---|---|---|---|
| 1 | destination_spotlight | visa_tip | student_story | agency_promo |
| 2 | visa_tip | destination_spotlight | destination_spotlight | student_story |
| 3 | student_story | agency_promo | visa_tip | destination_spotlight |
| 4 | agency_promo | student_story | agency_promo | visa_tip |

Audience assignment cycles through all 5 segments in this order: `estudiantes_secundaria → universitarios → padres → profesionales → adultos`, advancing by one segment per record created (across all days and weeks). Destino/Tema and CTA are left blank — the team fills these in Airtable before the scheduled generation runs.

---

## Pipeline Architecture

### Step Runner (`src/pipeline.js`)

The runner executes a typed list of steps for each post type. After each step completes successfully, it writes the step name to the `Paso completado` field in Airtable. On retry, the runner reads this field and skips already-completed steps.

**Steps per post type:**

```
single_photo:  caption[generate-content]  → image[generate-image ×1]    → brand[×1] → save
carousel:      caption[generate-carousel] → image[generate-carousel ×4] → brand[×4] → save
reel:          caption[generate-content]  → image[generate-image ×1]    → brand[×1] → video[generate-reel] → save
```

Note: `generate-carousel.js` handles both Claude JSON generation and Ideogram image calls for all 4 slides in a single module.

**Step execution contract:**

Each step function receives `(record, context)` and returns an updated `context` object carrying its output forward to the next step. This keeps steps pure and testable.

**Skip logic:** If `record.Estado === 'Omitir'`, the runner logs and returns `{ skipped: true }` immediately without executing any steps.

---

## Webhook Endpoints

All POST endpoints validate `WEBHOOK_SECRET` via the `x-webhook-secret` header (or `secret` query param for `/retry`).

| Endpoint | Caller | Body | Action |
|---|---|---|---|
| `POST /generate` | Make.com | `{ recordId }` | Runs full pipeline for the record |
| `POST /publish` | Airtable automation | `{ recordId }` | Posts approved content to Instagram |
| `GET /retry/:recordId` | Error email link | — | Resumes pipeline from last completed step |
| `GET /images/:filename` | Instagram Graph API | — | Serves branded image; deletes file 10 min after first serve |
| `GET /health` | Railway | — | Returns `{ ok: true }` |

---

## Instagram Publishing

**single_photo:**
1. Create media container with `image_url` + `caption`
2. Publish container

**carousel:**
1. Create one child container per branded slide image (4 total)
2. Create carousel container with `media_type: CAROUSEL`, `children`, `caption`
3. Publish container

**reel:**
1. Create media container with `media_type: REELS`, `video_url`, `caption`
2. Poll `GET /{creation_id}?fields=status_code` every 10s until `status_code = FINISHED` (max 3 min)
3. Publish container

All publishing uses the System User Token (`INSTAGRAM_SYSTEM_USER_TOKEN`) — non-expiring.

---

## Error Handling

**Per API call:** exponential backoff on 429 and 5xx responses (initial delay 1s, max 3 retries, multiplier 2×).

**Per pipeline step failure:**
1. Log full error with step name and record ID
2. Update Airtable: `Estado = Error`, `Notas = "[step]: [error message]"`
3. Call `send-alert.js` with: which step failed, the error, and a retry URL (`GET /retry/:recordId?secret=...`)
4. Return HTTP 500 to caller

**On retry (`GET /retry/:recordId`):**
1. Read `Paso completado` field from Airtable
2. Reset `Estado` to `En cola`
3. Run pipeline, skipping steps already marked complete
4. On success, proceed normally; on failure, same alert flow

---

## Image Serving

Branded images are saved to `/tmp/branded-[uuid].jpg` and served via `GET /images/:filename`. A 10-minute deletion timer is set when the file is first served. The URL format is `[RAILWAY_PUBLIC_URL]/images/[uuid].jpg`.

This URL is passed directly to the Instagram Graph API for media container creation — Instagram downloads the image server-side, so 10 minutes is ample.

---

## Environment Variables

```
ANTHROPIC_API_KEY=
IDEOGRAM_API_KEY=
KLING_API_KEY=
KLING_API_BASE_URL=https://api.klingai.com
AIRTABLE_API_KEY=
AIRTABLE_BASE_ID=
AIRTABLE_TABLE_NAME=Contenido Instagram
INSTAGRAM_ACCOUNT_ID=
INSTAGRAM_SYSTEM_USER_TOKEN=
INSTAGRAM_API_VERSION=v21.0
LOGO_PATH=./assets/logo.png
LOGO_POSITION=southeast
ALERT_EMAIL=
SENDGRID_API_KEY=
PORT=3000
WEBHOOK_SECRET=
RAILWAY_PUBLIC_URL=           ← set after Railway deploy
```

---

## Guard Rails

- Never commit `.env`
- Never delete Airtable records — only update `Estado`
- Never publish without a valid Airtable record in `Aprobado` state
- Always validate `WEBHOOK_SECRET` before processing any request
- All image/video URLs must be publicly reachable before passing to Graph API
- Handle 429 responses with exponential backoff on all external APIs
- Stop and ask before: changing Airtable schema, changing webhook URL, changing Instagram API version, any destructive action

---

## Out of Scope

- Scheduling logic (handled by Make.com)
- Instagram account creation or Meta Business setup
- Content strategy decisions (Destino/Tema, CTA choices — team fills these in Airtable)
- Analytics or performance tracking post-publish
