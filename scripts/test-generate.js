import 'dotenv/config';
import { runPipeline } from '../src/pipeline.js';
import { fetchRecord } from '../src/save-to-airtable.js';

const recordId = process.argv[2];

if (!recordId) {
  console.error('Usage: node scripts/test-generate.js <recordId>');
  console.error('Example: node scripts/test-generate.js recXXXXXXXXXXXXXX');
  console.error('\nFind a record ID by opening any record in Airtable — it appears in the URL.');
  process.exit(1);
}

console.log(`Running generation pipeline for record ${recordId}\n`);
console.log('This will call Claude, Ideogram, and Kling APIs (~$0.15 in API costs).\n');

try {
  const result = await runPipeline(recordId);

  if (result.skipped) {
    console.log('Record was skipped (Estado=Omitir).');
    process.exit(0);
  }

  console.log('\nPipeline complete. Fetching final record state...\n');

  const record = await fetchRecord(recordId);

  console.log('Estado:         ', record['Estado']);
  console.log('Paso completado:', record['Paso completado']);
  console.log('Caption:        ', (record['Caption generado'] ?? '').slice(0, 120), '...');

  if (record['URL imagen'])  console.log('URL imagen:     ', record['URL imagen']);
  if (record['Slides JSON']) console.log('Slides JSON:    ', record['Slides JSON'].slice(0, 120), '...');
  if (record['URL Video'])   console.log('URL Video:      ', record['URL Video']);

  console.log('\nReview the record in Airtable, then set Estado → Aprobado to publish.');
} catch (err) {
  console.error('\nPipeline failed:', err.message);
  process.exit(1);
}
