import 'dotenv/config';
import { PILLAR_ROTATION, AUDIENCE_ROTATION, pickCTA } from '../src/utils/pillar-rotation.js';

const API_KEY    = process.env.AIRTABLE_API_KEY;
const BASE_ID    = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME ?? 'Contenido Instagram';
const AT_REST    = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;
const HEADERS    = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

// PILLAR_ROTATION, AUDIENCE_ROTATION and pickCTA live in
// src/utils/pillar-rotation.js — the shared source of truth also used by
// scripts/seed-next-weeks.js.
// 8-week cycle, 4 distinct pillars per week (7 pillars total, weighted mix).

const DAYS = [
  { offset: 0, nombre: 'Lunes',     tipo: 'single_photo' },
  { offset: 2, nombre: 'Miércoles', tipo: 'carousel'     },
  { offset: 4, nombre: 'Viernes',   tipo: 'reel'         },
  { offset: 5, nombre: 'Sábado',    tipo: 'single_photo' },
];

const COUNTRIES = [
  'Australia',
];

async function fetchAllRecordIds() {
  const ids = [];
  let offset;

  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (offset) params.set('offset', offset);

    const resp = await fetch(`${AT_REST}?${params}`, { headers: HEADERS });
    if (!resp.ok) throw new Error(`Failed to fetch records: ${await resp.text()}`);

    const json = await resp.json();
    for (const r of json.records) ids.push(r.id);
    offset = json.offset;
  } while (offset);

  return ids;
}

async function deleteRecords(ids) {
  for (let i = 0; i < ids.length; i += 10) {
    const batch  = ids.slice(i, i + 10);
    const params = new URLSearchParams(batch.map(id => ['records[]', id]));
    const resp   = await fetch(`${AT_REST}?${params}`, { method: 'DELETE', headers: HEADERS });
    if (!resp.ok) throw new Error(`Failed to delete records: ${await resp.text()}`);
    console.log(`✓ Deleted records ${i + 1}–${Math.min(i + 10, ids.length)}`);
  }
}

async function seedCalendar() {
  const monday = nextMonday();
  const records = [];
  let audienceIdx = 0;
  let countryIdx  = 0;

  for (let week = 0; week < PILLAR_ROTATION.length; week++) {
    for (let dayIdx = 0; dayIdx < DAYS.length; dayIdx++) {
      const { offset, nombre, tipo } = DAYS[dayIdx];
      const date   = new Date(monday);
      date.setDate(monday.getDate() + week * 7 + offset);
      // Every 2nd week the Saturday single_photo becomes a news_update post —
      // current news for students and parents, sourced via web search at
      // generation time (or a link the team pastes into Notas beforehand).
      const isNewsSlot = dayIdx === 3 && week % 2 === 1;
      const pilar  = isNewsSlot ? 'news_update' : PILLAR_ROTATION[week][dayIdx];
      const pais   = COUNTRIES[countryIdx % COUNTRIES.length];
      const fechaStr = localDateStr(date);

      records.push({
        fields: {
          'Fecha publicación': fechaStr,
          Día:                 nombre,
          'Tipo de post':      tipo,
          Pilar:               pilar,
          Audiencia:           AUDIENCE_ROTATION[audienceIdx % AUDIENCE_ROTATION.length],
          'Destino/Tema':      pais,
          CTA:                 pickCTA({ 'Fecha publicación': fechaStr }, pilar),
          Estado:              'En cola',
        },
      });

      audienceIdx++;
      countryIdx++;
    }
  }

  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const resp  = await fetch(AT_REST, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify({ records: batch, typecast: true }),
    });
    if (!resp.ok) throw new Error(`Failed to create records: ${await resp.text()}`);
    console.log(`✓ Created records ${i + 1}–${Math.min(i + 10, records.length)}`);
  }

  console.log(`\nSchedule starts Monday ${localDateStr(monday)}`);
  console.log('Destino/Tema and CTA are pre-assigned — records are ready to trigger.');
}

function nextMonday(from = new Date()) {
  const d = new Date(from);
  const day = d.getDay();
  d.setDate(d.getDate() + ((8 - day) % 7 || 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

function localDateStr(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

async function main() {
  console.log('GlobeHop — Airtable reset\n');

  console.log('Fetching existing records...');
  const ids = await fetchAllRecordIds();
  console.log(`Found ${ids.length} records to delete\n`);

  if (ids.length) await deleteRecords(ids);

  console.log('\nSeeding 4-week schedule...');
  await seedCalendar();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Reset failed:', err.message);
  process.exit(1);
});
