# GlobeHop International — Instagram Automation

Automated pipeline publishing 4 Instagram posts/week (Mon/Wed/Fri/Sat, 8am Bogotá) for a Colombian international education agency. Content is AI-generated, stored in Airtable for human review, and published after approval. Triggered by Make.com; runs on Railway.

---

## Tech Stack

| Layer | Tool |
|---|---|
| Runtime | Node.js 20+ ESM — all files use `import`/`export` |
| AI content | Claude API `claude-sonnet-4-6` — captions, hooks, 4-scene reel prompts (Spanish) |
| AI images | Ideogram API — photos and carousel slides |
| AI video | Kling API (`api.klingai.com`) — image-to-video for reels |
| Image processing | Sharp — logo overlay on generated images |
| Data / approval | Airtable REST — content calendar + `Estado` state machine |
| Scheduling | Make.com — triggers `/generate` 4×/week with `recordId` |
| Publishing | Instagram Graph API v21.0 — photo, carousel, reel |
| Hosting | Railway — webhook server + temporary image serving |
| Email | SendGrid — error alerts + publish confirmations |

---

## Key Directories

```
instagram-automation/
├── src/
│   ├── pipeline.js           Pipeline runner — orchestrates all generation steps
│   ├── webhook.js            Express server — POST /generate, /publish, GET /retry, /images, /health
│   ├── generate-content.js   Claude API — caption + hook + 4-scene visual/text prompts
│   ├── generate-image.js     Ideogram API — single image (single_photo, reel scenes)
│   ├── generate-carousel.js  Ideogram API — 4 slide images in parallel
│   ├── generate-reel.js      Kling API — image-to-video with async polling
│   ├── apply-brand.js        Sharp — logo + hook overlay for single_photo
│   ├── apply-brand-video.js  FFmpeg — multi-scene assembly, per-scene overlays, music mix
│   ├── humanize-caption.js   Claude API — rewrite pass to remove AI-ness from caption
│   ├── upload-cdn.js         Cloudinary — permanent URL for videos and branded images
│   ├── save-to-airtable.js   Airtable REST — step persistence + Estado state machine
│   ├── post-to-instagram.js  Instagram Graph API — photo + carousel publish
│   ├── post-reel.js          Instagram Graph API — reel publish with container polling
│   ├── send-alert.js         SendGrid — error alerts + publish confirmations
│   └── utils/retry.js        Shared exponential backoff wrapper
├── scripts/
│   ├── setup-airtable.js     One-time: create schema only (no seeding)
│   ├── reset-airtable.js     Clear all records + seed fresh 4-week calendar with auto-assigned
│   │                         Destino/Tema (rotating all 7 countries) and CTA (by pillar)
│   ├── test-generate.js      Integration test: full generation pipeline
│   └── test-post.js          Integration test: publish an approved record to Instagram
└── assets/
    ├── logo.png              Team-provided; never committed
    └── music/                Royalty-free MP3/M4A/AAC tracks — one is picked randomly per reel
```

---

## Essential Commands

```bash
# One-time: create Airtable table schema (does not seed records)
node scripts/setup-airtable.js

# Reset: delete all records + seed fresh 4-week calendar (destinations + CTAs auto-assigned)
node scripts/reset-airtable.js

# Integration test: full generation pipeline (~$0.50 in API costs — runs 4 Kling clips)
node scripts/test-generate.js

# Integration test: publish an approved Airtable record to Instagram
node scripts/test-post.js

# Start server (production and local dev)
node src/webhook.js

# Trigger generation for a specific record (requires server running)
curl -X POST http://localhost:3000/generate \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
  -d '{"recordId":"recXXXXXXXXXXXXXX"}'

# Health check
curl http://localhost:3000/health
```

---

## Guard Rails

- `.env` is never committed — all secrets via environment variables only
- Airtable records are never deleted mid-pipeline — only `Estado` is updated. Exception: `reset-airtable.js` is the designated reset tool and intentionally deletes all records before reseeding.
- `WEBHOOK_SECRET` is validated before processing any webhook request
- `/publish` only executes if `Estado === 'Aprobado'`
- Stop and ask before: Airtable schema changes, webhook URL changes, Instagram API version changes

---

## Additional Documentation

| Topic | File |
|---|---|
| Pipeline patterns, retry logic, step contracts | `.claude/docs/architectural_patterns.md` |
| Airtable schema + Estado state machine | `docs/superpowers/specs/2026-06-03-instagram-automation-design.md:61-92` |
| Content system: post types, pillars, audiences, CTAs | `docs/superpowers/specs/2026-06-03-instagram-automation-design.md:96-130` |
| Webhook endpoints + Instagram publishing flows | `docs/superpowers/specs/2026-06-03-instagram-automation-design.md:134-165` |
| Environment variables (full list) | `docs/superpowers/specs/2026-06-03-instagram-automation-design.md:196-215` |
| Full implementation plan (build order, per-file details) | `/Users/julian/.claude/plans/ask-me-questions-to-generic-unicorn.md` |
