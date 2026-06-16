import { withRetry } from './utils/retry.js';

const AT_BASE = 'https://api.airtable.com/v0';

function tableUrl(recordId = '') {
  const base  = process.env.AIRTABLE_BASE_ID;
  const table = encodeURIComponent(process.env.AIRTABLE_TABLE_NAME);
  return `${AT_BASE}/${base}/${table}${recordId ? `/${recordId}` : ''}`;
}

function authHeaders() {
  return {
    Authorization:  `Bearer ${process.env.AIRTABLE_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function patchRecord(recordId, fields) {
  return withRetry(async () => {
    const resp = await fetch(tableUrl(recordId), {
      method:  'PATCH',
      headers: authHeaders(),
      body:    JSON.stringify({ fields }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[airtable] PATCH ${recordId} ${resp.status} body:`, body);
      const err  = new Error(`Airtable PATCH failed (HTTP ${resp.status})`);
      err.status = resp.status;
      throw err;
    }

    return resp.json();
  });
}

/**
 * Reads a single Airtable record and returns its fields object.
 *
 * @param {string} recordId
 * @returns {Promise<object>} Record fields keyed by field name
 */
export async function fetchRecord(recordId) {
  return withRetry(async () => {
    const resp = await fetch(tableUrl(recordId), { headers: authHeaders() });

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[airtable] GET ${recordId} ${resp.status} body:`, body);
      const err  = new Error(`Airtable GET failed (HTTP ${resp.status})`);
      err.status = resp.status;
      throw err;
    }

    const json = await resp.json();
    return json.fields;
  });
}

/**
 * Writes step output fields and marks the step complete.
 * Called by pipeline.js after every successful step.
 *
 * @param {string} recordId
 * @param {string} stepName   e.g. 'caption', 'image', 'brand', 'video'
 * @param {object} fields     Step-specific Airtable fields to write
 */
export async function saveStep(recordId, stepName, fields) {
  await patchRecord(recordId, { ...fields, 'Paso completado': stepName });
}

/**
 * Marks the record as published and stores the Instagram permalink.
 *
 * @param {string} recordId
 * @param {string} postUrl   Instagram permalink returned by the Graph API
 */
export async function markPublished(recordId, postUrl) {
  await patchRecord(recordId, {
    Estado:               'Publicado',
    'URL post publicado': postUrl,
  });
}

/**
 * Resets Estado to 'En cola' without touching Paso completado.
 * Used by /retry so the pipeline resumes from the last successful step.
 *
 * @param {string} recordId
 */
export async function markEnCola(recordId) {
  await patchRecord(recordId, { Estado: 'En cola' });
}

/**
 * Marks the record as failed and writes the error context to Notas.
 * Called by pipeline.js on any step failure before sending the alert email.
 *
 * @param {string} recordId
 * @param {string} stepName   Step that failed
 * @param {string} message    Error message
 */
export async function markError(recordId, stepName, message) {
  await patchRecord(recordId, {
    Estado: 'Error',
    Notas:  `[${stepName}]: ${message}`,
  });
}

/**
 * Sets Estado to 'Omitir' — skips the record in all future pipeline runs.
 * Used by the review dashboard reject action.
 */
export async function markOmitir(recordId) {
  await patchRecord(recordId, { Estado: 'Omitir' });
}

/**
 * Fetches all records currently in 'Pendiente revisión' state, sorted by
 * publication date. Used by the review dashboard to list content awaiting approval.
 *
 * @returns {Promise<Array>} Array of Airtable record objects ({ id, fields })
 */
export async function fetchPendingRecords() {
  return withRetry(async () => {
    const params = new URLSearchParams();
    params.set('filterByFormula', "{Estado}='Pendiente revisión'");
    params.set('sort[0][field]', 'Fecha publicación');
    params.set('sort[0][direction]', 'asc');
    for (const f of [
      'Tipo de post', 'Destino/Tema', 'Fecha publicación', 'Estado',
      'URL imagen branded', 'URL imagen', 'Caption generado', 'Hook',
      'URL Video', 'Slides JSON',
    ]) params.append('fields[]', f);

    const resp = await fetch(`${tableUrl()}?${params}`, { headers: authHeaders() });
    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[airtable] list pending ${resp.status} body:`, body);
      const err  = new Error(`Airtable list failed (HTTP ${resp.status})`);
      err.status = resp.status;
      throw err;
    }
    const json = await resp.json();
    return json.records ?? [];
  });
}

