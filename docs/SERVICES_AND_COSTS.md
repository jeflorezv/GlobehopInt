# GlobeHop Instagram Automation — Services & Billing

**Last updated:** September 2026  
**Current scope:** Australia only · single_photo + carousel + reel · 4 posts/week (1 reel/week)

---

## Services Summary

| Service | Role | Monthly Cost | Billing URL |
|---------|------|-------------|-------------|
| Anthropic (Claude API) | AI captions, hooks, humanization | ~$0.05–0.10 | https://console.anthropic.com/settings/billing |
| Ideogram API | AI image generation | ~$1.50–2.50 | https://ideogram.ai/manage-plan |
| Google Veo 3.1 (Gemini API) | AI video / reels | ~A$38.55/month (1 reel/week, 720p/4s) — verified against real billing | https://console.cloud.google.com/billing |
| Railway | Server hosting | ~$5–10 | https://railway.app/account/billing |
| Make.com | Scheduler / webhook trigger | Free (under 1,000 ops/mo) | https://www.make.com/en/billing |
| Airtable | Content calendar + state machine | Free | https://airtable.com/account |
| Cloudinary | CDN — image + video storage | Free (under 25 GB) | https://console.cloudinary.com/billing |
| SendGrid | Error alerts + publish confirmations | Free (under 100/day) | https://app.sendgrid.com/settings/billing |
| Instagram Graph API | Publishing to Instagram | Free (Meta) | https://developers.facebook.com |

---

## Cost Detail by Service

### 1. Anthropic — Claude API
**URL:** https://console.anthropic.com/settings/billing  
**Model:** `claude-sonnet-4-6`  
**Calls per post:**
- single_photo: 2 calls (generate-content + humanize)
- carousel: 2 calls (generate-carousel + humanize)

**Per post cost:** ~$0.003  
**Monthly (16 posts, current scope):** ~$0.05–0.10  
**Recommendation:** Keep $5–10 credit — very low burn rate.

---

### 2. Ideogram API
**URL:** https://ideogram.ai/manage-plan  
**Model:** V_3, REALISTIC  
**Calls per post:**
- single_photo: 1 image
- carousel: 6 images (parallel)

**Per image cost:** ~$0.04–0.08  
**Monthly breakdown:**
- 8 single_photos × 1 image = 8 images × ~$0.06 = ~$0.48
- 4 carousels × 6 images = 24 images × ~$0.06 = ~$1.44  
**Monthly total: ~$1.90**  
**Recommendation:** Keep $10–20 credit. This is the highest variable cost.

---

### 3. Google Veo 3.1 (Gemini Developer API) — replaces Kling AI, migrated Sept 2026
**URL:** https://console.cloud.google.com/billing (billing must be linked to the AI Studio project — the free tier has zero Veo quota)  
**API base:** `https://generativelanguage.googleapis.com`  
**Model:** `veo-3.1-generate-preview`, **720p**, `durationSeconds: 4`, `personGeneration: allow_adult` — cost-optimized 2026-09-16, see below.  
**Billing rate — verified 2026-09-16 against actual Cloud Console billing** (SKU-level, "My Billing Account", AUD): both `Veo Generation 1080p with Audio` and `Veo Generation 720p with Audio` bill at the identical **A$0.556/sec** — resolution alone does not change the per-second price. The flagship preview model has no way to disable native audio via the REST API, so every clip bills at this audio-inclusive rate even though this pipeline discards all source audio and always mixes its own `assets/music/` track instead.  
**Duration is resolution-gated, confirmed live against the API:** 1080p only accepts `durationSeconds: 8` (its default — 4 and 6 are both rejected with `"1080p is not supported for a duration of N seconds"`). 720p accepts 4. Odd values (5, 7) are rejected at any resolution. So 720p isn't cheaper per second — it's the *only* resolution that unlocks a shorter, cheaper clip at all.  
**Per clip (720p, 4s):** A$2.23  
**Per reel (4 scenes):** A$8.90  
**Monthly (1 reel/week ≈ 4.33 reels/month):** ~A$38.55  
**Tradeoff:** the published Instagram reel is unaffected in resolution — `apply-brand-video.js` upscales the 720p source back to 1080×1920 during branding either way. What *does* change: total reel length drops from 20s to 16s (4 scenes × 4s instead of × 5s), since Veo's clip is now genuinely 4s long rather than an 8s clip trimmed down.  
**History:** was 1080p/8s-default (~A$4.45/clip, ~A$77/month) from the initial Sept 15 migration; before that, an even-earlier estimate based on published rates (not real billing) guessed ~$104/month. Cut to the current 720p/4s config on 2026-09-16 specifically because the higher figure was flagged as too expensive — real verified saving is ~50%, not from resolution downgrade as such but from the duration it unlocks.  
**Recommendation:** re-verify this per-clip rate in Cloud Console after a production cycle to confirm it holds; if Veo's supported duration set ever changes (e.g. a future model version allowing 720p at 8s alongside a lower rate, or 1080p allowing shorter durations), revisit `generate-reel.js`'s `RESOLUTION`/`DURATION_SECONDS` constants.

---

### 4. Railway
**URL:** https://railway.app/account/billing  
**Service name:** `globehop-instagram`  
**Production URL:** https://globehop-instagram-production.up.railway.app  
**Plan:** Hobby or Pro (compute + egress)  
**Monthly estimate:** $5–10 depending on traffic and image serving volume  
**Recommendation:** Keep a card on file; enable usage alerts at $15.

---

### 5. Make.com
**URL:** https://www.make.com/en/billing  
**Usage:** 4 webhook triggers/week = ~17 operations/month  
**Free tier:** 1,000 operations/month  
**Current cost:** $0 — well within free tier.  
**Recommendation:** No action needed unless adding more automations.

---

### 6. Airtable
**URL:** https://airtable.com/account  
**Usage:** Single table, ~100 records, REST API calls  
**Free tier:** 1,000 records/base, 1,000 API calls/month  
**Current cost:** $0  
**Recommendation:** Monitor if records accumulate past 1,000. Run `reset-airtable.js` periodically to clear old records.

---

### 7. Cloudinary
**URL:** https://console.cloudinary.com/billing  
**Usage:** Branded images + carousel slides stored permanently  
**Free tier:** 25 GB storage, 25 GB bandwidth/month  
**Estimated monthly upload:** ~50 MB (16 posts × ~3 MB avg)  
**Current cost:** $0  
**Recommendation:** No action needed for current volume.

---

### 8. SendGrid
**URL:** https://app.sendgrid.com/settings/billing  
**Usage:** Error alerts + publish confirmations (~16–30 emails/month)  
**Free tier:** 100 emails/day  
**Current cost:** $0  
**Recommendation:** No action needed.

---

## Monthly Cost Summary

### Current scope (4 posts/week: 3 single_photo/carousel + 1 reel)
| Item | Cost |
|------|------|
| Anthropic Claude API | ~$0.10–0.15 |
| Ideogram API | ~$1.90 |
| Google Veo 3.1 (1 reel/week, 4 clips, 720p/4s) | ~A$38.55 (verified against billing, cost-optimized 2026-09-16) |
| Railway hosting | ~$5–10 |
| Everything else | $0 |
| **Total** | **~A$45–50 / month** (Anthropic/Ideogram/Railway lines are USD; Veo is the AUD-denominated billing account's own currency — treat this total as approximate until currency-normalized) |

---

## Top-Up Checklist

Before the automation can stall due to insufficient funds, check these in order:

- [ ] **Google Cloud (Veo 3.1)** — largest line item (~A$38.55/month, verified 2026-09-16 post cost-optimization); the account runs on prepaid credits, not an invoice — it hit **zero balance** during this migration's testing and needed a manual top-up at ai.studio/projects. Set a usage alert in Cloud Console and check the balance ahead of each reel cycle until this is confirmed stable.
- [ ] **Ideogram** — keep ≥$10 credit
- [ ] **Railway** — keep a valid payment method on file
- [ ] **Anthropic** — keep ≥$5 credit

Make.com, Airtable, Cloudinary, and SendGrid are all free at current volume — no action needed.
