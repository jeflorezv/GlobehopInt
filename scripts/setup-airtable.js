import 'dotenv/config';

const API_KEY    = process.env.AIRTABLE_API_KEY;
const BASE_ID    = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME ?? 'Contenido Instagram';

const AT_REST = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;
const AT_META = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`;

const HEADERS = {
  Authorization:  `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

const TABLE_FIELDS = [
  { name: 'Fecha publicación',   type: 'date',         options: { dateFormat: { name: 'iso' } } },
  { name: 'Día',                 type: 'singleSelect', options: { choices: [
    { name: 'Lunes' }, { name: 'Miércoles' }, { name: 'Viernes' }, { name: 'Sábado' },
  ]}},
  { name: 'Tipo de post',        type: 'singleSelect', options: { choices: [
    { name: 'single_photo' }, { name: 'carousel' }, { name: 'reel' },
  ]}},
  { name: 'Pilar',               type: 'singleSelect', options: { choices: [
    { name: 'destination_spotlight' }, { name: 'visa_tip' },
    { name: 'student_story' },         { name: 'agency_promo' },
  ]}},
  { name: 'Audiencia',           type: 'singleSelect', options: { choices: [
    { name: 'estudiantes_secundaria' }, { name: 'universitarios' },
    { name: 'padres' },                 { name: 'profesionales' }, { name: 'adultos' },
  ]}},
  { name: 'Destino/Tema',        type: 'singleLineText' },
  { name: 'CTA',                 type: 'singleSelect', options: { choices: [
    { name: 'Agenda tu consultoría gratuita' },
    { name: 'Escríbenos por DM' },
    { name: 'Link en bio' },
    { name: 'Comenta abajo' },
    { name: 'Visita nuestro sitio web' },
  ]}},
  { name: 'Estado',              type: 'singleSelect', options: { choices: [
    { name: 'En cola' }, { name: 'Pendiente revisión' }, { name: 'Aprobado' },
    { name: 'Publicado' }, { name: 'Omitir' }, { name: 'Error' },
  ]}},
  { name: 'Caption generado',    type: 'multilineText' },
  { name: 'URL imagen',          type: 'url' },
  { name: 'Slides JSON',         type: 'multilineText' },
  { name: 'URL Video',           type: 'url' },
  { name: 'Descripción visual',  type: 'singleLineText' },
  { name: 'Paso completado',     type: 'singleLineText' },
  { name: 'URL post publicado',  type: 'url' },
  { name: 'Notas',               type: 'multilineText' },
];

const PILLAR_ROTATION = [
  ['destination_spotlight', 'visa_tip',              'student_story',       'agency_promo'        ],
  ['visa_tip',              'destination_spotlight', 'destination_spotlight','student_story'       ],
  ['student_story',         'agency_promo',          'visa_tip',            'destination_spotlight'],
  ['agency_promo',          'student_story',         'agency_promo',        'visa_tip'            ],
];

const DAYS = [
  { offset: 0, nombre: 'Lunes',      tipo: 'single_photo' },
  { offset: 2, nombre: 'Miércoles',  tipo: 'carousel'     },
  { offset: 4, nombre: 'Viernes',    tipo: 'reel'         },
  { offset: 5, nombre: 'Sábado',     tipo: 'single_photo' },
];

const AUDIENCES = [
  'estudiantes_secundaria', 'universitarios', 'padres', 'profesionales', 'adultos',
];

async function main() {
  console.log('GlobeHop — Airtable setup\n');
  await ensureTable();
  await seedCalendar();
  console.log('\nDone. Open Airtable and fill in Destino/Tema and CTA before the first run.');
}

async function ensureTable() {
  const resp = await fetch(AT_META, { headers: HEADERS });
  if (!resp.ok) throw new Error(`Failed to list tables: ${await resp.text()}`);

  const { tables } = await resp.json();
  if (tables.some(t => t.name === TABLE_NAME)) {
    console.log(`✓ Table "${TABLE_NAME}" already exists — skipping creation`);
    return;
  }

  const create = await fetch(AT_META, {
    method:  'POST',
    headers: HEADERS,
    body:    JSON.stringify({ name: TABLE_NAME, fields: TABLE_FIELDS }),
  });

  if (!create.ok) throw new Error(`Failed to create table: ${await create.text()}`);
  console.log(`✓ Table "${TABLE_NAME}" created`);
}

async function seedCalendar() {
  const monday = nextMonday();
  const records = [];
  let audienceIdx = 0;

  for (let week = 0; week < 4; week++) {
    for (let dayIdx = 0; dayIdx < DAYS.length; dayIdx++) {
      const { offset, nombre, tipo } = DAYS[dayIdx];
      const date = new Date(monday);
      date.setDate(monday.getDate() + week * 7 + offset);

      records.push({
        fields: {
          'Fecha publicación': date.toISOString().split('T')[0],
          Día:                 nombre,
          'Tipo de post':      tipo,
          Pilar:               PILLAR_ROTATION[week][dayIdx],
          Audiencia:           AUDIENCES[audienceIdx % AUDIENCES.length],
          Estado:              'En cola',
        },
      });

      audienceIdx++;
    }
  }

  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const resp  = await fetch(AT_REST, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify({ records: batch }),
    });

    if (!resp.ok) throw new Error(`Failed to create records: ${await resp.text()}`);

    const end = Math.min(i + 10, records.length);
    console.log(`✓ Created records ${i + 1}–${end}`);
  }
}

function nextMonday(from = new Date()) {
  const d   = new Date(from);
  const day = d.getDay();
  d.setDate(d.getDate() + ((8 - day) % 7 || 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

main().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
