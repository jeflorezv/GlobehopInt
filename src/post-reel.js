import { withRetry } from './utils/retry.js';

const VERSION = process.env.INSTAGRAM_API_VERSION ?? 'v21.0';
const BASE    = `https://graph.facebook.com/${VERSION}`;
const ACCOUNT = () => process.env.INSTAGRAM_ACCOUNT_ID;
const TOKEN   = () => process.env.INSTAGRAM_SYSTEM_USER_TOKEN;

const POLL_INTERVAL_MS = 10_000; // 10 s between polls
const MAX_POLLS        = 18;     // 3-minute window total

/**
 * Publishes an approved reel to Instagram.
 * Creates the media container, waits for Instagram to process the video,
 * then publishes and returns the permalink.
 *
 * @param {object} record  Airtable record fields (Estado must be 'Aprobado')
 * @returns {Promise<{ postUrl: string }>}
 */
export async function postReel(record) {
  const caption  = record['Caption generado'];
  const videoUrl = record['URL Video'];

  if (!videoUrl) throw new Error('post-reel: URL Video is empty');

  // Step 1: create reel container
  const { id: containerId } = await graphPost(`/${ACCOUNT()}/media`, {
    media_type: 'REELS',
    video_url:  videoUrl,
    caption,
  });

  // Step 2: poll until Instagram finishes processing the video
  await pollUntilFinished(containerId);

  // Step 3: publish
  const { id: mediaId } = await graphPost(`/${ACCOUNT()}/media_publish`, {
    creation_id: containerId,
  });

  const postUrl = await getPermalink(mediaId);
  return { postUrl };
}

// ─── polling ─────────────────────────────────────────────────────────────────

async function pollUntilFinished(containerId) {
  const deadline = Date.now() + (MAX_POLLS * POLL_INTERVAL_MS);

  while (true) {
    const json = await withRetry(async () => {
      const params = new URLSearchParams({ fields: 'status_code' });
      const resp   = await fetch(`${BASE}/${containerId}?${params}`, {
        headers: { Authorization: `Bearer ${TOKEN()}` },
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const msg  = data?.error?.message ?? resp.statusText;
        const err  = new Error(`Graph API poll ${resp.status}: ${msg}`);
        err.status = resp.status;
        throw err;
      }

      return resp.json();
    });

    const status = json?.status_code;

    if (status === 'FINISHED') return;
    if (status === 'ERROR') {
      throw new Error(`Graph API: reel container ${containerId} processing failed`);
    }

    if (Date.now() >= deadline) break;
    await sleep(POLL_INTERVAL_MS);
  }

  const elapsed = (MAX_POLLS * POLL_INTERVAL_MS) / 1000;
  throw new Error(`Graph API: reel container ${containerId} timed out after ${elapsed}s`);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function graphPost(path, body) {
  return withRetry(async () => {
    const resp = await fetch(`${BASE}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...body, access_token: TOKEN() }),
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      const msg  = data?.error?.message ?? resp.statusText;
      const err  = new Error(`Graph API POST ${path} ${resp.status}: ${msg}`);
      err.status = resp.status;
      throw err;
    }

    return resp.json();
  });
}

async function getPermalink(mediaId) {
  return withRetry(async () => {
    const params = new URLSearchParams({ fields: 'permalink' });
    const resp   = await fetch(`${BASE}/${mediaId}?${params}`, {
      headers: { Authorization: `Bearer ${TOKEN()}` },
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      const msg  = data?.error?.message ?? resp.statusText;
      const err  = new Error(`Graph API GET permalink ${resp.status}: ${msg}`);
      err.status = resp.status;
      throw err;
    }

    const json = await resp.json();
    if (!json.permalink) throw new Error(`Graph API: no permalink in response for ${mediaId}`);
    return json.permalink;
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
