import { createHash } from 'node:crypto';
import { readFile }   from 'node:fs/promises';

function getConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      'Cloudinary not configured — set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET'
    );
  }
  return { cloudName, apiKey, apiSecret };
}

function makeSignature(timestamp, apiSecret, extraParams = {}) {
  // Cloudinary signs all non-file params sorted alphabetically by key.
  const params = { timestamp, ...extraParams };
  const toSign = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha256')
    .update(`${toSign}${apiSecret}`)
    .digest('hex');
}

async function cloudinaryUpload(endpoint, form) {
  const resp = await fetch(endpoint, { method: 'POST', body: form });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Cloudinary upload failed (${resp.status}): ${body}`);
  }
  const json = await resp.json();
  if (!json.secure_url) throw new Error('Cloudinary: no secure_url in response');
  return json.secure_url;
}

/**
 * Uploads a local JPEG file to Cloudinary and returns a permanent HTTPS URL.
 *
 * @param {string} filePath  Absolute path to the JPEG file
 * @param {string} filename  Display filename for the upload
 * @returns {Promise<string>}
 */
export async function uploadToCdn(filePath, filename) {
  const { cloudName, apiKey, apiSecret } = getConfig();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = makeSignature(timestamp, apiSecret);

  const buf  = await readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'image/jpeg' }), filename);
  form.append('api_key', apiKey);
  form.append('timestamp', timestamp);
  form.append('signature', signature);

  return cloudinaryUpload(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    form,
  );
}

/**
 * Uploads a remote image URL to Cloudinary (Cloudinary fetches it server-side).
 * Used to give Kling a permanent, non-expiring source image URL.
 *
 * @param {string} sourceUrl  Public URL of the image to fetch and store
 * @returns {Promise<string>}
 */
export async function uploadUrlToCdn(sourceUrl) {
  const { cloudName, apiKey, apiSecret } = getConfig();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = makeSignature(timestamp, apiSecret);

  const form = new FormData();
  form.append('file', sourceUrl);
  form.append('api_key', apiKey);
  form.append('timestamp', timestamp);
  form.append('signature', signature);

  return cloudinaryUpload(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    form,
  );
}

/**
 * Uploads raw text/JSON content to Cloudinary as a `raw` resource and returns
 * a permanent HTTPS URL. Used for non-media backups (e.g. Airtable snapshots).
 *
 * @param {string} content   Raw file content (e.g. JSON.stringify(...))
 * @param {string} filename  Display filename for the upload (public_id derives from this)
 * @param {string} [mimeType] MIME type for the uploaded blob (default application/json)
 * @returns {Promise<string>}
 */
export async function uploadRawToCdn(content, filename, mimeType = 'application/json') {
  const { cloudName, apiKey, apiSecret } = getConfig();
  const timestamp = String(Math.floor(Date.now() / 1000));
  // Strip the extension for public_id — Cloudinary appends its own based on
  // the uploaded resource, and a literal ".json" in public_id gets doubled.
  const publicId  = filename.replace(/\.[^.]+$/, '');
  const signature = makeSignature(timestamp, apiSecret, { public_id: publicId });

  const form = new FormData();
  form.append('file', new Blob([content], { type: mimeType }), filename);
  form.append('api_key', apiKey);
  form.append('timestamp', timestamp);
  form.append('public_id', publicId);
  form.append('signature', signature);

  return cloudinaryUpload(
    `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`,
    form,
  );
}

/**
 * Uploads a local MP4 video file to Cloudinary and returns a permanent HTTPS URL.
 *
 * @param {string} filePath  Absolute path to the MP4 file
 * @param {string} filename  Display filename for the upload
 * @returns {Promise<string>}
 */
export async function uploadVideoToCdn(filePath, filename) {
  const { cloudName, apiKey, apiSecret } = getConfig();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = makeSignature(timestamp, apiSecret);

  const buf  = await readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'video/mp4' }), filename);
  form.append('api_key', apiKey);
  form.append('timestamp', timestamp);
  form.append('signature', signature);

  return cloudinaryUpload(
    `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`,
    form,
  );
}
