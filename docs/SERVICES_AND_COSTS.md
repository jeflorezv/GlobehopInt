# GlobeHop Instagram Automation — Services & Billing

**Last updated:** June 2026  
**Current scope:** Australia only · single_photo + carousel · 4 posts/week · reels paused

---

## Services Summary

| Service | Role | Monthly Cost | Billing URL |
|---------|------|-------------|-------------|
| Anthropic (Claude API) | AI captions, hooks, humanization | ~$0.05–0.10 | https://console.anthropic.com/settings/billing |
| Ideogram API | AI image generation | ~$1.50–2.50 | https://ideogram.ai/manage-plan |
| Kling AI | AI video / reels *(paused)* | $0 now / ~$1.05 when active | https://klingai.com/pricing |
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

### 3. Kling AI *(paused — reels not in production)*
**URL:** https://klingai.com/pricing  
**API base:** `https://api.klingai.com`  
**Cost when active:** ~$0.10–0.30 per reel clip  
**Monthly (4 reels × 3 clips each):** ~$1.20–3.60  
**Current cost:** $0 — reels are paused.  
**Recommendation:** Top up $20 before re-enabling reels.

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

### Current scope (no reels)
| Item | Cost |
|------|------|
| Anthropic Claude API | ~$0.10 |
| Ideogram API | ~$1.90 |
| Railway hosting | ~$5–10 |
| Everything else | $0 |
| **Total** | **~$7–12 / month** |

### With reels enabled (16 posts/week incl. 4 reels)
| Item | Cost |
|------|------|
| Anthropic Claude API | ~$0.15 |
| Ideogram API | ~$3.50 |
| Kling AI (3 clips/reel) | ~$2.40 |
| Railway hosting | ~$5–10 |
| Everything else | $0 |
| **Total** | **~$11–16 / month** |

---

## Top-Up Checklist

Before the automation can stall due to insufficient funds, check these in order:

- [ ] **Ideogram** — most likely to run out; keep ≥$10 credit
- [ ] **Railway** — keep a valid payment method on file
- [ ] **Anthropic** — keep ≥$5 credit
- [ ] **Kling** — only relevant when reels are re-enabled; load $20 before launch

Make.com, Airtable, Cloudinary, and SendGrid are all free at current volume — no action needed.
