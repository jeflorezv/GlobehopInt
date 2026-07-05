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
 * Saves marketing team edits to caption and/or hook before publishing.
 * Called by POST /review/:recordId/save-edits.
 *
 * @param {string} recordId
 * @param {{ caption?: string, hook?: string }} edits
 */
export async function saveEdits(recordId, { caption, hook } = {}) {
  const fields = {};
  if (caption !== undefined) fields['Caption generado'] = caption;
  if (hook    !== undefined) fields['Hook']             = hook;
  if (Object.keys(fields).length) await patchRecord(recordId, fields);
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

/**
 * Fetches the story lines of recent news_update posts so the news researcher
 * can avoid covering the same story twice. Returns the "[news] headline — url"
 * Notas entries (falling back to caption openings) of the last few news posts.
 *
 * @param {number} limit  How many recent news posts to consider
 * @returns {Promise<string[]>}
 */
export async function fetchRecentNewsStories(limit = 4) {
  return withRetry(async () => {
    const params = new URLSearchParams();
    params.set('filterByFormula', "AND({Pilar}='news_update', {Caption generado}!='')");
    params.set('sort[0][field]', 'Fecha publicación');
    params.set('sort[0][direction]', 'desc');
    params.set('maxRecords', String(limit));
    for (const f of ['Notas', 'Caption generado']) params.append('fields[]', f);

    const resp = await fetch(`${tableUrl()}?${params}`, { headers: authHeaders() });
    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[airtable] list news ${resp.status} body:`, body);
      const err  = new Error(`Airtable list failed (HTTP ${resp.status})`);
      err.status = resp.status;
      throw err;
    }
    const json = await resp.json();
    return (json.records ?? []).map(r => {
      const notas = r.fields['Notas'] ?? '';
      if (notas.startsWith('[news]')) return notas;
      return (r.fields['Caption generado'] ?? '').split('\n')[0];
    }).filter(Boolean);
  });
}

/**
 * Sets Estado to 'Aprobado' — content approved for scheduled publishing.
 * The post will be published automatically by /publish-scheduled on the correct date.
 */
export async function markApproved(recordId) {
  await patchRecord(recordId, { Estado: 'Aprobado' });
}

/**
 * Fetches all records currently in 'Aprobado' state, sorted by publication date.
 * Used by the review dashboard to show content approved and awaiting auto-publish.
 */
export async function fetchApprovedRecords() {
  return withRetry(async () => {
    const params = new URLSearchParams();
    params.set('filterByFormula', "{Estado}='Aprobado'");
    params.set('sort[0][field]', 'Fecha publicación');
    params.set('sort[0][direction]', 'asc');
    for (const f of [
      'Tipo de post', 'Destino/Tema', 'Fecha publicación',
      'URL imagen branded', 'URL imagen',
    ]) params.append('fields[]', f);

    const resp = await fetch(`${tableUrl()}?${params}`, { headers: authHeaders() });
    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[airtable] list approved ${resp.status} body:`, body);
      const err  = new Error(`Airtable list failed (HTTP ${resp.status})`);
      err.status = resp.status;
      throw err;
    }
    const json = await resp.json();
    return json.records ?? [];
  });
}

