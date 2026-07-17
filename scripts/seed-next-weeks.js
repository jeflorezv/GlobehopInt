/**
 * Additively seeds upcoming weeks onto the existing Airtable calendar using
 * the shared PILLAR_ROTATION (src/utils/pillar-rotation.js). Unlike
 * reset-airtable.js, this script never deletes anything — it only appends
 * new "En cola" records starting from the next Monday after the latest
 * scheduled record, so it is safe to run against a live calendar that
 * already has posts in review/approved/published states.
 *
 * Usage: node scripts/seed-next-weeks.js [weeks]   (default 4 weeks)
 */
import 'dotenv/config';
import { PILLAR_ROTATION, CTA_BY_PILLAR } from '../src/utils/pillar-rotation.js';

const API_KEY    = process.env.AIRTABLE_API_KEY;
const BASE_ID    = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME ?? 'Contenido Instagram';
const AT_REST    = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;
const HEADERS    = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

const DAYS = [
  { offset: 0, nombre: 'Lunes',     tipo: 'single_photo' },
  { offset: 2, nombre: 'Miércoles', tipo: 'carousel'     },
  { offset: 4, nombre: 'Viernes',   tipo: 'reel'         },
  { offset: 5, nombre: 'Sábado',    tipo: 'single_photo' },
];

const AUDIENCES = [
  'estudiantes_secundaria', 'universitarios', 'padres', 'profesionales', 'adultos',
];

const COUNTRIES = ['Australia'];

function localDateStr(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

async function fetchLatestDate() {
  const params = new URLSearchParams({
    pageSize:             '1',
    'sort[0][field]':     'Fecha publicación',
    'sort[0][direction]': 'desc',
  });
  const resp = await fetch(`${AT_REST}?${params}`, { headers: HEADERS });
  if (!resp.ok) throw new Error(`Failed to fetch latest record: ${await resp.text()}`);
  const json = await resp.json();
  return json.records[0]?.fields?.['Fecha publicación'] ?? null;
}

function nextMondayAfter(dateStr) {
  const base = dateStr ? new Date(...dateStr.split('-').map((v, i) => i === 1 ? Number(v) - 1 : Number(v))) : new Date();
  const d = new Date(base);
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

async function seedWeeks(weekCount) {
  const latestDate = await fetchLatestDate();
  const monday      = nextMondayAfter(latestDate);
  console.log(`Latest scheduled record: ${latestDate ?? '(none)'}`);
  console.log(`Appending ${weekCount} week(s) starting Monday ${localDateStr(monday)}\n`);

  const records = [];
  let audienceIdx = 0;
  let countryIdx  = 0;

  for (let week = 0; week < weekCount; week++) {
    const rotationRow = PILLAR_ROTATION[week % PILLAR_ROTATION.length];
    for (let dayIdx = 0; dayIdx < DAYS.length; dayIdx++) {
      const { offset, nombre, tipo } = DAYS[dayIdx];
      const date = new Date(monday);
      date.setDate(monday.getDate() + week * 7 + offset);

      const isNewsSlot = dayIdx === 3 && week % 2 === 1;
      const pilar = isNewsSlot ? 'news_update' : rotationRow[dayIdx];
      const pais  = COUNTRIES[countryIdx % COUNTRIES.length];

      records.push({
        fields: {
          'Fecha publicación': localDateStr(date),
          Día:                 nombre,
          'Tipo de post':      tipo,
          Pilar:               pilar,
          Audiencia:           AUDIENCES[audienceIdx % AUDIENCES.length],
          'Destino/Tema':      pais,
          CTA:                 CTA_BY_PILLAR[pilar],
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
    const json = await resp.json();
    json.records.forEach(r => {
      console.log(`✓ ${r.fields['Fecha publicación']} ${r.fields['Día']} — ${r.fields['Tipo de post']} / ${r.fields['Pilar']}`);
    });
  }

  console.log('\nDone.');
}

const weekCount = Number(process.argv[2]) || 4;

seedWeeks(weekCount).catch(err => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
