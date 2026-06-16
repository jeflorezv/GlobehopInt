import { withRetry } from './utils/retry.js';

const VERSION   = process.env.INSTAGRAM_API_VERSION ?? 'v21.0';
const BASE      = `https://graph.facebook.com/${VERSION}`;
const ACCOUNT   = () => process.env.INSTAGRAM_ACCOUNT_ID;
const TOKEN     = () => process.env.INSTAGRAM_SYSTEM_USER_TOKEN;

/**
 * Publishes an approved Airtable record to Instagram.
 * Handles single_photo and carousel post types.
 * Reel publishing is handled by src/post-reel.js.
 *
 * @param {object} record  Airtable record fields (Estado must be 'Aprobado')
 * @returns {Promise<{ postUrl: string }>}
 */
export async function postToInstagram(record) {
  const tipo = record['Tipo de post'];

  if (tipo === 'carousel') return postCarousel(record);
  return postPhoto(record);
}

// ─── single_photo ────────────────────────────────────────────────────────────

async function postPhoto(record) {
  const caption  = record['Caption generado'];
  const imageUrl = record['URL imagen branded'] ?? record['URL imagen'];

  if (!imageUrl) throw new Error('post-to-instagram: no image URL on record');

  const { id: containerId } = await graphPost(`/${ACCOUNT()}/media`, {
    image_url: imageUrl,
    caption,
  });

  await waitForContainer(containerId);

  const { id: mediaId } = await graphPost(`/${ACCOUNT()}/media_publish`, {
    creation_id: containerId,
  });

  const postUrl = await getPermalink(mediaId);
  return { postUrl };
}

// ─── carousel ────────────────────────────────────────────────────────────────

async function postCarousel(record) {
  const caption = record['Caption generado'];
  const slides  = parseSlides(record['Slides JSON']);

  if (!slides.length) throw new Error('post-to-instagram: Slides JSON is empty or invalid');

  // Step 1: child containers — created in parallel, then wait for each to finish
  const childIds = await Promise.all(
    slides.map(slide => createChildContainer(slide.imageUrl))
  );
  await Promise.all(childIds.map(id => waitForContainer(id)));

  // Step 2: carousel container
  const { id: containerId } = await graphPost(`/${ACCOUNT()}/media`, {
    media_type: 'CAROUSEL',
    caption,
    children:   childIds,
  });

  // Step 3: wait for carousel container, then publish
  await waitForContainer(containerId);
  const { id: mediaId } = await graphPost(`/${ACCOUNT()}/media_publish`, {
    creation_id: containerId,
  });

  const postUrl = await getPermalink(mediaId);
  return { postUrl };
}

async function createChildContainer(imageUrl) {
  if (!imageUrl) throw new Error('post-to-instagram: carousel slide missing imageUrl');

  // Instagram requires JPEG for carousel items — convert Cloudinary PNGs on the fly
  const jpegUrl = imageUrl.replace(/\.png(\?.*)?$/, '.jpg$1');

  const { id } = await graphPost(`/${ACCOUNT()}/media`, {
    image_url:        jpegUrl,
    is_carousel_item: true,
  });
  return id;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function waitForContainer(containerId, timeoutMs = 90_000, intervalMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const params = new URLSearchParams({ fields: 'status_code' });
    const resp   = await fetch(`${BASE}/${containerId}?${params}`, {
      headers: { Authorization: `Bearer ${TOKEN()}` },
    });
    if (resp.ok) {
      const { status_code } = await resp.json();
      if (status_code === 'FINISHED') return;
      if (status_code === 'ERROR' || status_code === 'EXPIRED') {
        throw new Error(`post-to-instagram: container ${containerId} status: ${status_code}`);
      }
    }
    if (Date.now() >= deadline) break;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`post-to-instagram: container ${containerId} did not finish within ${timeoutMs / 1000}s`);
}

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

function parseSlides(slidesJson) {
  if (!slidesJson) return [];
  try {
    return JSON.parse(slidesJson);
  } catch {
    throw new Error(`post-to-instagram: invalid Slides JSON: ${String(slidesJson).slice(0, 100)}`);
  }
}
