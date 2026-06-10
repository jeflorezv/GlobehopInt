import 'dotenv/config';
import { fetchRecord, markPublished } from '../src/save-to-airtable.js';
import { postToInstagram }            from '../src/post-to-instagram.js';
import { postReel }                   from '../src/post-reel.js';
import { sendPublishConfirmation }    from '../src/send-alert.js';

const recordId = process.argv[2];

if (!recordId) {
  console.error('Usage: node scripts/test-post.js <recordId>');
  console.error('Example: node scripts/test-post.js recXXXXXXXXXXXXXX');
  console.error('\nThe record must have Estado = Aprobado before running this script.');
  process.exit(1);
}

console.log(`Publishing record ${recordId} to Instagram...\n`);

let record;
try {
  record = await fetchRecord(recordId);
} catch (err) {
  console.error('Failed to fetch record:', err.message);
  process.exit(1);
}

if (record['Estado'] !== 'Aprobado') {
  console.error(`Estado must be "Aprobado" to publish. Current Estado: "${record['Estado']}"`);
  console.error('Set Estado → Aprobado in Airtable, then re-run this script.');
  process.exit(1);
}

const tipo = record['Tipo de post'];
console.log(`Post type: ${tipo}`);

try {
  const { postUrl } = tipo === 'reel'
    ? await postReel(record)
    : await postToInstagram(record);

  await markPublished(recordId, postUrl);
  await sendPublishConfirmation({ recordId, tipo, postUrl }).catch(() => {});

  console.log('\nPublished successfully!');
  console.log('Post URL:', postUrl);
} catch (err) {
  console.error('\nPublish failed:', err.message);
  process.exit(1);
}
