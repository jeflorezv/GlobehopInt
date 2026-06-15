# Architectural Patterns

Patterns observed across `src/pipeline.js`, `src/webhook.js`, and all integration modules.
References point to the design spec: `docs/superpowers/specs/2026-06-03-instagram-automation-design.md`.

---

## 1. Named-Step Pipeline Runner

**Where:** `src/pipeline.js` orchestrates all integration modules.

Every post type maps to an ordered list of named steps. The runner iterates steps sequentially and stops on the first failure. Carousel uses the same step names as single_photo but `generate-carousel.js` internally handles the ×4 image variation.

Step lists per post type:
```
single_photo:  caption → humanize → image → brand → save
carousel:      caption → humanize → image → brand → save   # image step is carousel-aware
reel:          caption → humanize → images → video → save  # images (plural) = 4 parallel Ideogram calls; no brand step (overlays applied by FFmpeg post-Kling)
```

Skip logic: if `record['Estado'] === 'Omitir'`, return `{ skipped: true }` before executing any steps.

---

## 2. Step Context Threading

**Where:** `src/pipeline.js`, all `src/generate-*.js` and `src/apply-brand.js`.

Each step function has the signature `(record, ctx) → ctx`. The runner merges each return value into a shared `ctx` object and passes it to the next step. This keeps steps pure (no side effects beyond their return) and independently testable.

- `record` — the raw Airtable record fields, read-only within steps
- `ctx` — accumulates outputs: `caption`, `visual`, `hook`, `imageUrl`, `scenes` (reel), `slides` (carousel), `videoUrl`, `tmpPath`

---

## 3. Intermediate State Persistence

**Where:** `src/pipeline.js` calls `src/save-to-airtable.js` after every step.

After each step succeeds, two writes happen to Airtable:
1. The step's output fields (e.g., `Caption generado`, `URL imagen`)
2. `Paso completado = stepName`

This makes the pipeline resumable at any step boundary. On retry, `runPipeline` reads `Paso completado` from the record and skips all steps up to and including that index — spec:113-131.

Field-to-step mapping — spec:table after "Intermediate save contract":
| Step | Airtable fields written |
|---|---|
| caption | `Caption generado`, `Descripción visual`, `Hook`, `Slides JSON` (scenes for reel) |
| humanize | `Caption generado` (overwrites with humanized version) |
| image | `URL imagen` |
| images (reel) | `Slides JSON` (scenes array with imageUrls), `URL imagen` (scene 0 preview) |
| brand | `URL imagen branded`, `Imagen preview` (attachment) |
| video | `URL Video` (Cloudinary URL) |
| save | `Estado = Pendiente revisión` |

---

## 4. Airtable as State Machine

**Where:** `src/webhook.js` (checks Estado before acting), `src/pipeline.js` (writes Estado), `scripts/setup-airtable.js` (seeds `En cola`).

`Estado` is the authoritative lifecycle field. Valid transitions:

```
En cola → (pipeline runs) → Pendiente revisión
Pendiente revisión → (human approves) → Aprobado
Aprobado → (webhook /publish) → Publicado
* → (any step failure) → Error
* → (team skips) → Omitir
```

Guard rule: `/publish` endpoint verifies `Estado === 'Aprobado'` before calling Graph API — spec:139-143. Nothing publishes without an explicit human approval transition.

---

## 5. Shared Exponential Backoff Wrapper

**Where:** `src/utils/retry.js`, imported by every module that calls an external API.

Signature: `withRetry(fn, { retries = 3, delay = 1000, multiplier = 2 })`.

All external calls — Claude, Ideogram, Kling, Instagram Graph API, SendGrid — wrap their `fetch`/SDK call in `withRetry`. The wrapper retries on 429 and 5xx; it rethrows immediately on 4xx (except 429) since those indicate caller errors that a retry won't fix.

---

## 6. Webhook Secret Middleware

**Where:** `src/webhook.js` — applied to every endpoint except `GET /health`.

All POST endpoints read `x-webhook-secret` from headers. The `GET /retry/:recordId` endpoint reads `secret` from the query string (because it's invoked from a browser link in an email). A single `requireSecret(req, res, next)` middleware function is reused across all routes — spec:135-137.

---

## 7. Module-per-Integration

**Where:** every file in `src/` except `pipeline.js` and `webhook.js`.

One module = one external API or one infrastructure concern. No module imports another integration module directly — they are all wired together only in `pipeline.js` and `webhook.js`. This means any integration can be tested in isolation by calling its exported function with a stubbed input.

| Module | Integration |
|---|---|
| `generate-content.js` | Claude API — caption, hook overlay (3-line), 4-scene visual+text prompts for reels |
| `humanize-caption.js` | Claude API — second pass to strip AI-sounding language from caption |
| `generate-image.js` | Ideogram API — single image per call (used for single_photo and each reel scene) |
| `generate-carousel.js` | Ideogram API — 4 slide images generated in parallel |
| `generate-reel.js` | Kling API — image-to-video (async submit + poll), cfg_scale 0.3, std mode |
| `apply-brand.js` | Sharp — logo overlay + 3-level gradient/text hook for single_photo |
| `apply-brand-video.js` | FFmpeg — trims Kling clips to 2.5s, applies per-scene overlays via `movie` filter loop, concat, optional music mix at 15% volume |
| `upload-cdn.js` | Cloudinary — permanent storage for videos and branded images |
| `save-to-airtable.js` | Airtable REST — per-step field writes + Estado state machine |
| `post-to-instagram.js` | Instagram Graph API — photo + carousel publish |
| `post-reel.js` | Instagram Graph API — reel publish with container status polling |
| `send-alert.js` | SendGrid — error alerts + publish confirmations |

---

## 8. Async Polling Pattern

**Where:** `src/generate-reel.js` (Kling), `src/post-reel.js` (Instagram reel status).

Both Kling video generation and Instagram reel processing are async — the submission returns a task/creation ID, and completion must be polled. Both use the same structure: submit → poll loop with fixed interval and max attempt cap → throw on timeout or failure.

- Kling: 15s interval, 20 attempts (5-minute window per clip × 4 clips = up to 20 min total)
- Instagram reel: 10s interval, 18 attempts (3-minute window)
