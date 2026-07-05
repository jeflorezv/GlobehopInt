import 'dotenv/config';

const API_KEY  = process.env.AIRTABLE_API_KEY;
const BASE_ID  = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME ?? 'Contenido Instagram';
const HEADERS  = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

const COUNTRIES = [
  'Estados Unidos', 'Canadá', 'Reino Unido', 'Australia', 'Irlanda',
  'Nueva Zelanda', 'España', 'Francia', 'Alemania', 'Italia',
  'Portugal', 'Países Bajos', 'Suiza', 'Bélgica', 'Austria',
  'Suecia', 'Noruega', 'Dinamarca', 'Japón', 'Corea del Sur',
  'Malta', 'Dubai', 'Turquía', 'Chipre', 'México', 'Argentina',
];

async function main() {
  // 1. Find the table ID and Destino/Tema field ID
  const resp = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, { headers: HEADERS });
  if (!resp.ok) throw new Error(`Failed to list tables: ${await resp.text()}`);

  const { tables } = await resp.json();
  const table = tables.find(t => t.name === TABLE_NAME);
  if (!table) throw new Error(`Table "${TABLE_NAME}" not found`);

  const field = table.fields.find(f => f.name === 'Destino/Tema');
  if (!field) throw new Error('Field "Destino/Tema" not found');

  console.log(`Found field "${field.name}" (${field.type}) — ID: ${field.id}`);

  // 2. PATCH the field to singleSelect with country choices
  const patch = await fetch(
    `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${table.id}/fields/${field.id}`,
    {
      method:  'PATCH',
      headers: HEADERS,
      body: JSON.stringify({
        type:    'singleSelect',
        options: { choices: COUNTRIES.map(name => ({ name })) },
      }),
    }
  );

  if (!patch.ok) {
    const body = await patch.text();
    throw new Error(`Failed to update field: ${body}`);
  }

  console.log('✓ Destino/Tema converted to single-select dropdown');
  console.log(`  ${COUNTRIES.length} countries added`);
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
