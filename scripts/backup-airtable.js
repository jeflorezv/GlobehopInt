/**
 * Read-only snapshot of the entire Airtable table, uploaded to Cloudinary as
 * a timestamped JSON file. Never modifies or deletes any Airtable record.
 *
 * Run manually before any risky operation (e.g. before touching
 * reset-airtable.js), or on a schedule via POST /backup-airtable
 * (triggered biweekly by Make.com — see CLAUDE.md).
 *
 * Usage: node scripts/backup-airtable.js
 */
import 'dotenv/config';
import { runBackupWithAlert } from '../src/backup-airtable.js';

const { url, recordCount } = await runBackupWithAlert();
console.log(`✓ Backed up ${recordCount} records`);
console.log(`  ${url}`);
