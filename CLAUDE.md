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
│       ├── pillar-rotation.js   Shared PILLAR_ROTATION + CTA_BY_PILLAR (7 pillars, 8-week cycle)
│       ├── variety.js           Topic banks (16 angles × 7 pillars) + scene archetypes + hashStr
│       └── parse-json.js        Robust JSON extraction from Claude responses
├── scripts/
│   ├── setup-airtable.js        One-time: create schema only (no seeding)
│   ├── reset-airtable.js        DESTRUCTIVE: clear all records + seed fresh 8-week calendar
│   ├── seed-next-weeks.js       Non-destructive: append N future weeks onto the existing calendar
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
| **POST** | **`/review/:recordId/reject`** | **form body `reviewToken`** | **Capture rejection reason and regenerate from scratch** |
| POST | `/backup-airtable` | `X-Webhook-Secret` | Read-only snapshot of the full Airtable table, uploaded to Cloudinary |

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
6. **Rechazar y regenerar** → requires a reason, clears the generated media/copy, returns the record to `En cola`, and immediately generates a new version using that feedback. The regenerated post returns to `Pendiente revisión`.

### Airtable Backups

**Added 2026-08-01** after an incident where two Airtable-mutating scripts (`reset-airtable.js`, `seed-next-weeks.js`) were run unintentionally with no backup or Airtable revision history to recover from. Airtable revision history is a paid-tier feature and is not enabled on this base — this backup system is the only restore point.

- `src/backup-airtable.js` — `backupAirtable()` paginates through every record via `fetchAllRecords()` (`save-to-airtable.js`), and uploads a timestamped JSON snapshot (`{ exportedAt, table, recordCount, records }`) to Cloudinary as a `raw` resource via `uploadRawToCdn()` (`upload-cdn.js`). Entirely read-only against Airtable. `runBackupWithAlert()` wraps this with a SendGrid confirmation/failure email (`sendBackupConfirmation` / `sendBackupFailureAlert` in `send-alert.js`).
- **`POST /backup-airtable`** — secret-protected endpoint, triggered by a **biweekly Make.com scheduled module** (same pattern as the existing `/generate-next` weekly trigger — add a Make.com scenario with a schedule module set to every 14 days, calling this endpoint with the `X-Webhook-Secret` header). Returns `{ ok, recordCount, url }`.
- `scripts/backup-airtable.js` — thin CLI wrapper (`node scripts/backup-airtable.js`) for on-demand snapshots, e.g. before running `reset-airtable.js` or any other destructive operation.
- Cloudinary was chosen over local disk because Railway's filesystem is ephemeral (wiped on redeploy) and Cloudinary is already configured for this project.
- Backups are not currently pruned — Cloudinary raw storage is cheap at this volume (a few KB per snapshot, every 2 weeks). Revisit if this becomes a real cost.

---

## Essential Commands

```bash
# One-time: create Airtable table schema (does not seed records)
node scripts/setup-airtable.js

# Reset (DESTRUCTIVE): delete all records + seed fresh 8-week calendar
node scripts/reset-airtable.js

# Append N future weeks onto the existing calendar without deleting anything (default 4 weeks)
node scripts/seed-next-weeks.js [weeks]

# Focus: mark all reel + non-Australia records as Omitir (run once after reset)
node scripts/focus-australia.js

# Integration test: full generation pipeline (single_photo, carousel, or reel)
node scripts/test-generate.js

# Integration test: publish an approved Airtable record to Instagram
node scripts/test-post.js

# On-demand backup: snapshot the full Airtable table to Cloudinary (read-only, safe anytime)
node scripts/backup-airtable.js

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
                                          → (Rechazar + motivo) → En cola → (regenerar) → Pendiente revisión
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
| Single photo / reel gradient (bottom) | `apply-brand.js` `gradMaxOpa` | `0.60` (reel), `0.40` (photo) |
| Simple scene text gradient (bottom) | `apply-brand.js` `createSimpleTextPng` | `0.42` |
| Carousel hook slide | `render-carousel.js` `hookHtml` | `0.32` |
| Carousel statement slide | `render-carousel.js` `statementHtml` | `0.30` |
| Carousel list slide | `render-carousel.js` `listHtml` | `0.35` |
| Carousel fact slide | `render-carousel.js` `factHtml` | `0.33` |
| Carousel CTA slide | `render-carousel.js` `ctaHtml` | `0.45` |

### Logo / Icon
- **Standardized 2026-07-17:** single_photo, reel overlays, and carousel slides all use the same brand mark now — the `icon-no-bg.png` 3D "G" icon, sized `width * 0.165` (≈ 178px on 1080px frame), in a dark rounded pill (`#1C2631` @ 0.42 opacity), top-left at 20px from left / 48px from top. Previously single_photo used the full `logo.png` at `width * 0.28` with no pill background while reels and carousel each had their own slightly different treatment — three different marks across three post types. `apply-brand.js`'s `buildIconBadge()` is the single implementation shared by `createOverlayPng`, `applyBrand`, and `createSimpleTextPng`; `render-carousel.js`'s `logoPill()` mirrors the same ratio/pill styling in CSS since carousel slides render via Puppeteer, not Sharp.
- The full `logo.png` is still used standalone in `apply-brand.js`'s `createEndCardPng()` (the reel's final full-screen branded card, centered at `width * 0.55`) — that's a distinct full-screen design moment, not the recurring corner watermark, so it's intentionally exempt from the corner-mark standardization above.

### Sky and Weather Rules
All image prompts must produce **clear blue sky, bright sunshine, or warm sunrise**. Dark skies, stormy weather, heavy overcast, and night scenes are blocked via `negative_prompt` in both `generate-image.js` and `render-carousel.js`, and the `generate-content.js` system prompt explicitly prohibits them.

---

## Caption Voice & Style Rules

- **Aspirational framing, narrowed 2026-07-17:** Only `destination_spotlight` is required to lead with Australia's lifestyle appeal now. The original rule also forced `student_story`, `agency_promo`, and `city_spotlight` into the same "lifestyle/opportunity/growth" opening, which made 4 of 7 pillars read as the same generic inspirational post regardless of topic — exactly the "looks like one inspirational Australia page" complaint from marketing feedback. Each of those three pillars now opens specific to its own content instead (see the POSITIVE, ASPIRATIONAL FRAMING block in `generate-content.js` and the equivalent Spanish instruction in `generate-carousel.js`). `visa_tip` and `student_life` may open with a practical question or "how to" framing. `myth_vs_reality` opens with the myth itself stated plainly — a distinct format exempt from this rule.
- **Content purpose rule:** every post must serve exactly one of three outcomes — "quiero estudiar en Australia" (destination_spotlight, city_spotlight), "GlobeHop sabe ayudarme" (visa_tip, student_life, agency_promo), or "confío en GlobeHop" (student_story, myth_vs_reality). Added to stop posts blurring all three into one generic message.
- **No unverifiable crowd-size claims:** never "miles de colombianos", "cientos de estudiantes", "muchos ya lo hicieron", "cada vez más familias colombianas eligen Australia" — flagged directly by marketing as a repetitive, unverifiable pattern. Prompt rules in `generate-content.js`, `generate-carousel.js`, `humanize-caption.js`.
- **Consultation is always free, not just the first one:** never "primera asesoría gratis" / "asesoría inicial sin costo". Enforced at two levels like the dash rule below — prompt instructions plus a deterministic safety net, `fixConsultationClaim()` in `src/utils/text.js`, applied in `pipeline.js`'s `humanize` step alongside `stripDashes()`.
- **Audience is Latin America, not just Colombia:** GlobeHop serves students across LatAm with a strong Colombian base. Copy defaults to "estudiantes latinoamericanos" or addresses the reader directly; "colombianos" is used only when a topic is genuinely Colombia-specific. Updated in `generate-content.js`, `generate-carousel.js` (default audience fallback), and `humanize-caption.js`.
- **No em dashes or spaced hyphens in Spanish text:** Spanish doesn't use dashes as punctuation the way English does. Enforced at two levels — prompt rules in `generate-content.js`, `generate-carousel.js`, and `humanize-caption.js`, plus a deterministic safety net (`stripDashes()` in `src/utils/text.js`) applied in `pipeline.js`'s `humanize` step to caption, hook, every carousel slide field, and every reel scene's text, regardless of model compliance.
- **Hook model examples rewritten 2026-07-17:** the hardcoded "model examples" in `generate-content.js`'s hook field description were generic transformation lines ("tu mejor versión", "miles de colombianos ya dieron ese paso") that Claude was echoing near-verbatim across posts. Replaced with fewer, more Australia/education-specific examples and an explicit "tone reference only, don't reuse verbatim" instruction.

---

## Colombian Character Library

Character profiles are defined in `src/utils/characters.js`. Full profiles are sourced from `Review/GlobeHop_Female_Male_Character_Library.md` (11 female + 12 male profiles across 7 Colombian regions — Medellín, Cali, Barranquilla, Bogotá, Cartagena, Pereira, Bucaramanga). They are injected into image prompts only (not captions or hooks) via a `CHARACTER LOCK` block in the Claude user message.

**Selection logic (`selectCharacter(record)`):**
- `record.id` is set explicitly in `pipeline.js` (`record.id = recordId`) because `fetchRecord()` returns only fields (no `.id`). This must be present for gender alternation to work.
- Gender alternates deterministically per Airtable record ID (`hashStr('char:' + id) % 2`) — roughly 50/50 across posts
- All pillars share the same full profile pool (no per-pillar subsetting). The profile index rotates through every regional profile via the publish week — same mechanism as `pickTopic` — so every region cycles through before any repeat; falls back to a record-ID hash when there's no parseable publish date
- **No city or region of origin is included in the prompt text** — appearance descriptors only (region is tracked only via the `// CO_FEMALE_MEDELLIN_02`-style comment above each profile, for traceability back to the source file)
- Each profile includes photography style anchors (`authentic Colombian appearance`, `documentary photography`, `natural skin texture`, etc.) to prevent Ideogram from rendering generic AI faces

Both `generate-content.js` (single_photo/reel) and `generate-carousel.js` use `selectCharacter(record)`.

**Group scenes:** the system prompt's GROUP SCENE DIVERSITY RULE (in `generate-content.js`) governs any scene with more than one person (the "Group of 2–4 multicultural students" / "Friends of different backgrounds" archetypes, or the reel's `scene_student_life`): the CHARACTER LOCK person is exactly one of the people in frame, and every other person must visibly read as a different international background — never a clone of the same face, never additional Colombian-looking people.

**Wildlife realism:** the shared negative prompt (see below) blocks `plastic figure, toy figurine, statue, taxidermy, stuffed animal, doll-like animal`; the WILDLIFE SCENE DIRECTIVE in `generate-content.js` additionally asserts the animal must read as a real, living creature in National-Geographic-style wildlife photography.

**Age:** GlobeHop's audience is young people, so every human subject must render as clearly 20s, never older. All character profile ages are 23-28 and avoid "mature"-type wording that was previously pushing Ideogram toward middle-aged looking renders (grey hair, deep wrinkles) regardless of the stated number. Both `generate-content.js` and `generate-carousel.js` also carry an explicit AGE rule overriding any stated age, as a backstop.

**Shared negative prompt (`src/utils/negative-prompt.js`):** `BASE_NEGATIVE_PROMPT` is the single source of truth for Ideogram negative prompts, imported by both `generate-image.js` (single_photo/reel) and `render-carousel.js` (carousel slide backgrounds) — these used to be two independently-maintained near-duplicate strings that drifted out of sync (realism/signage/age fixes landed in one but not the other). Update this one file when tuning image realism; both post-type families pick it up automatically.

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
- Deterministic from the record's `Fecha publicación`: a continuous post counter (`weekIndex(date) * 4 + day slot`, Mon/Wed/Fri/Sat → 0–3) is permuted across the 22-location list by a stride of 5, which is coprime with 22. This guarantees **4 distinct cities per week** (consecutive counters land 5 apart) *and* **zero repeats across any run of 22 consecutive posts** (~5.5 weeks) — a full bijection over the location list. Replaces an earlier per-week-hash version that only guaranteed distinctness within a single week and let the same landmark recur across adjacent weeks (e.g. Brisbane's Story Bridge appearing in two posts days apart, fixed 2026-07-14).
- Same record always maps to the same location (idempotent retries work correctly); no in-memory state, deploy-restart safe
- Falls back to a record-ID hash if the record has no publish date
- Three locations are tagged `type: 'wildlife'` (Lone Pine koala, Rottnest quokka, Kangaroo Island kangaroos)
- Wildlife locations trigger a `WILDLIFE SCENE DIRECTIVE` in the Claude user message that makes the animal the primary visual subject and places the student character in the mid-ground

Pass the full record (fields + `.id`) — see pipeline.js note above.

---

## Content Variety System

Defined in `src/utils/variety.js`. All picks are deterministic (idempotent retries) and salted independently so location, character, topic, and scene never correlate.

### Content pillars (7 + news override)

Expanded 2026-07-14 from 4 pillars to 7, to fix repetitive topics/copy and align with a funnel-stage content mix (education → inspiration → trust → engagement). Rotation and CTA defaults are defined once in `src/utils/pillar-rotation.js` (`PILLAR_ROTATION`, `CTA_BY_PILLAR`) and imported by both `scripts/reset-airtable.js` and `scripts/seed-next-weeks.js` so the two seeding paths never drift apart.

| Pillar | Category | Angle |
|---|---|---|
| `visa_tip` | Education | Practical visa/immigration guidance, never states requirements as fixed fact |
| `student_life` | Education | Daily-life how-to: banking, SIM, TFN, resume, first job, budgeting |
| `destination_spotlight` | Inspiration | General Australia lifestyle appeal, tied to the CITY LOCK landmark |
| `city_spotlight` | Inspiration | Deep dive into ONE practical aspect of the CITY LOCK city (cost of living, neighborhoods, transport, job market) — replaces generic landmark photography with real per-city substance |
| `student_story` | Social proof | Personal/emotional narrative, third-person or first-person |
| `agency_promo` | Trust | GlobeHop's value proposition and differentiators |
| `myth_vs_reality` | Engagement | States one myth from the topic bank directly, then dismantles it — exempt from the "never open with reader's doubts" framing rule since stating the myth IS the format |
| `news_update` | News (biweekly override) | Every 2nd week's Saturday slot, overrides whatever pillar the rotation would have assigned — see below |

8-week rotation cycle (32 slots), rebalanced 2026-07-17 against marketing's requested mix: Education (`visa_tip`+`student_life`) 25%, Australia/cities (`city_spotlight`) ~19%, Student stories (`student_story`) ~19%, Inspirational (`destination_spotlight`) ~16%, Trust (`agency_promo`) 12.5%, Engagement (`myth_vs_reality`) ~9% (news is layered on top via the separate biweekly override, adding ~12.5% more). No pillar repeats within the same week. The requested "10% GlobeHop/team" bucket isn't broken out separately yet — it's folded into `agency_promo` until real team/student media exists (see below); once that content pipeline exists, `agency_promo` should split into a proper team-content pillar.

- **Topic bank (`pickTopic(record, pillar)`):** 16 specific angles per pillar (7 pillars × 16 = 112 angles total). Index = pillar hash + Monday-anchored week counter → the same pillar cycles through all 16 angles before repeating (16 weeks). Injected as `TOPIC LOCK` (generate-content) / `ÁNGULO ESPECÍFICO` (generate-carousel).
- **Carousel templates (`generate-carousel.js`):** T21 "City Deep Dive" was added specifically for `city_spotlight` (cost of living → neighborhoods/daily life → unique local detail → why this city fits); T12 "Student Life" and T07 "Myth vs Reality" were retagged to match the new `student_life` and `myth_vs_reality` pillars.
- **Scene archetypes (`pickSceneArchetype(record)`):** 10 visual archetypes rotated per record, injected as `SCENE ARCHETYPE LOCK` for single_photo posts.
- **Shared hash (`hashStr`):** FNV-1a — replaces the old character-sum hash whose collisions produced posts with identical city + character pairs.

### Deferred marketing feedback (2026-07-17)

Three items from marketing's feedback round are intentionally not yet implemented, pending decisions:
- **Parent/child decision-maker framing** ("Dejaste ir a tu hija...", the `padres` audience segment, carousel `T03 Parent Content`) — retiring or reworking this needs a decision on replacement framing, not just deletion.
- **CTA diversification beyond "Escribe «AUSTRALIA» al DM"** — that exact phrasing drives a live ManyChat DM-keyword automation (see the hook field comment in `generate-content.js`). Need to confirm whether ManyChat also triggers off comments before safely rotating in comment/save/share-based CTAs as primary lead-capture mechanisms.
- **Real people — students, Yamile, team, institution visits, testimonials** — the pipeline has no path today for the marketing team to attach real photos/video instead of Ideogram generation; every image is AI-generated. Needs a new capability (e.g. an Airtable field that skips the `image`/`render` step when real media is supplied) plus an ongoing supply of real content from the team. Blocks the "10% team" pillar slice and the AI/real-media balance marketing asked for.

### News posts (`news_update` pillar)

`src/generate-news.js` runs a research phase before generation using the Anthropic `web_search` server tool:
- Finds one story from the last ~14 days relevant to Colombian students/parents (visa policy, intakes, scholarships, work rules, cost of living, safety)
- **Hybrid sourcing:** if the team pastes an article URL into the record's `Notas` field before generation, that story is used instead of searching
- The story is injected into `generate-content.js` as a `NEWS LOCK`; the caption mentions the source naturally, never copies money figures (the `check` step blocks them), and always redirects to GlobeHop for exact details
- The covered story is written back to `Notas` as `[news] headline — url`; `fetchRecentNewsStories()` feeds these into future runs so stories don't repeat
- If no relevant story is found, the post falls back to the `visa_tip` topic bank
- Seeding: `reset-airtable.js` / `seed-next-weeks.js` mark every 2nd-week Saturday as `news_update`; new Pilar single-select options are created via `typecast: true` in the POST body (the Airtable API cannot edit select choices any other way)

### Curated reference sources (`src/utils/sources.js`)

Team-maintained list at `docs/latam_students_australia_sources.md` (official Australian government stats, university/testimonial pages, news coverage) — parsed once at module load into `getSourcesReferenceBlock()`. Team edits the markdown; no code change or redeploy needed for the content to take effect on the next process restart.
- `generate-news.js`: injected into the system prompt as "KNOWN RELIABLE SOURCES" — Claude prioritizes/cross-checks these before general web search when researching a `news_update` story
- `generate-content.js`: injected as an optional "REFERENCE SOURCES" block for `destination_spotlight`, `student_story`, `agency_promo`, and `city_spotlight` pillars only (never `visa_tip` or `student_life`, which already forbid stating specifics as fact; never `news_update`, which has its own dedicated NEWS LOCK) — Claude may ground one detail if it fits the TOPIC LOCK angle, must paraphrase (no URLs, no exact figures), and must never represent the Maria-from-Colombia story or YouTube testimonial video as an actual GlobeHop client
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
| Character profiles reference | `Review/GlobeHop_Female_Male_Character_Library.md` |
| Curated LatAm→Australia source list | `docs/latam_students_australia_sources.md` |
