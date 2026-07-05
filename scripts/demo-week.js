/**
 * Seeds 4 Australia posts for the current week (today's date on all records)
 * so /generate-next can pick them up immediately for a full-week demo.
 *
 * Run AFTER reset-airtable.js to clear existing records first.
 *
 * Usage: node scripts/demo-week.js
 */
import 'dotenv/config';

const API_KEY    = process.env.AIRTABLE_API_KEY;
const BASE_ID    = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME ?? 'Contenido Instagram';
const AT_REST    = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;
const HEADERS    = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

const RECORDS = [
  {
    'Fecha publicación': today,
    Día:                 'Lunes',
    'Tipo de post':      'single_photo',
    Pilar:               'destination_spotlight',
    Audiencia:           'universitarios',
    'Destino/Tema':      'Australia',
    CTA:                 'Escríbenos por DM',
    Estado:              'En cola',
  },
  {
    'Fecha publicación': today,
    Día:                 'Miércoles',
    'Tipo de post':      'carousel',
    Pilar:               'visa_tip',
    Audiencia:           'padres',
    'Destino/Tema':      'Australia',
    CTA:                 'Escríbenos por DM',
    Estado:              'En cola',
  },
  {
    'Fecha publicación': today,
    Día:                 'Viernes',
    'Tipo de post':      'single_photo',
    Pilar:               'student_story',
    Audiencia:           'profesionales',
    'Destino/Tema':      'Australia',
    CTA:                 'Escríbenos por DM',
    Estado:              'En cola',
  },
  {
    'Fecha publicación': today,
    Día:                 'Sábado',
    'Tipo de post':      'carousel',
    Pilar:               'agency_promo',
    Audiencia:           'adultos',
    'Destino/Tema':      'Australia',
    CTA:                 'Agenda tu consultoría gratuita',
    Estado:              'En cola',
  },
];

const resp = await fetch(AT_REST, {
  method:  'POST',
  headers: HEADERS,
  body:    JSON.stringify({ records: RECORDS.map(fields => ({ fields })) }),
});

if (!resp.ok) {
  console.error('Seed failed:', await resp.text());
  process.exit(1);
}

const json = await resp.json();
console.log(`Seeded ${json.records.length} records for today (${today}):`);
json.records.forEach(r => console.log(`  ${r.id}  ${r.fields['Tipo de post']}  ${r.fields['Pilar']}`));
