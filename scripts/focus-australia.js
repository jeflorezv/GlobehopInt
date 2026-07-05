/**
 * One-time migration: marks all non-Australia records as Omitir.
 * Australia records (all post types including reels) are left untouched.
 * Safe to run repeatedly — skips records already in terminal states (Publicado, Omitir).
 *
 * Usage: node scripts/focus-australia.js
 */
import 'dotenv/config';

const BASE_URL = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(process.env.AIRTABLE_TABLE_NAME ?? 'Contenido Instagram')}`;
const HEADERS  = {
  Authorization:  `Bearer ${process.env.AIRTABLE_API_KEY}`,
  'Content-Type': 'application/json',
};

async function listAll() {
  const records = [];
  let offset;
  do {
    const params = new URLSearchParams();
    for (const f of ['Destino/Tema', 'Tipo de post', 'Estado']) params.append('fields[]', f);
    if (offset) params.set('offset', offset);
    const resp = await fetch(`${BASE_URL}?${params}`, { headers: HEADERS });
    if (!resp.ok) throw new Error(`Airtable list failed: ${await resp.text()}`);
    const json = await resp.json();
    records.push(...(json.records ?? []));
    offset = json.offset;
  } while (offset);
  return records;
}

async function markOmitir(id) {
  const resp = await fetch(`${BASE_URL}/${id}`, {
    method:  'PATCH',
    headers: HEADERS,
    body:    JSON.stringify({ fields: { Estado: 'Omitir' } }),
  });
  if (!resp.ok) throw new Error(`PATCH ${id} failed: ${await resp.text()}`);
}

const TERMINAL = new Set(['Publicado', 'Omitir']);

const records = await listAll();
console.log(`Found ${records.length} total records.`);

let skipped = 0, updated = 0, alreadyDone = 0;

for (const r of records) {
  const f      = r.fields;
  const estado = f['Estado'] ?? '';
  const dest   = f['Destino/Tema'] ?? '';
  const tipo   = f['Tipo de post'] ?? '';

  if (TERMINAL.has(estado)) { alreadyDone++; continue; }

  const isAustralia = /australia/i.test(dest);

  if (!isAustralia) {
    process.stdout.write(`  Omitir ${r.id} [${tipo}] "${dest}" (${estado}) ... `);
    await markOmitir(r.id);
    console.log('done');
    updated++;
  } else {
    skipped++;
  }
}

console.log(`\nDone. ${updated} marked Omitir · ${skipped} Australia non-reel kept · ${alreadyDone} already terminal.`);
