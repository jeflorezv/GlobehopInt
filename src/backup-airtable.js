import { fetchAllRecords } from './save-to-airtable.js';
import { uploadRawToCdn } from './upload-cdn.js';
import { sendBackupConfirmation, sendBackupFailureAlert } from './send-alert.js';

/**
 * Fetches the full Airtable table and shapes it into the snapshot object
 * used by every backup destination (Cloudinary, and the monthly git copy
 * in monthly-backup.js) — kept separate so both share one Airtable fetch.
 *
 * @returns {Promise<{ exportedAt: string, table: string, recordCount: number, records: object[] }>}
 */
export async function buildAirtableSnapshot() {
  const table   = process.env.AIRTABLE_TABLE_NAME ?? 'Contenido Instagram';
  const records = await fetchAllRecords();

  return {
    exportedAt:  new Date().toISOString(),
    table,
    recordCount: records.length,
    records,
  };
}

/**
 * Snapshots the entire Airtable table to a timestamped JSON file on
 * Cloudinary. Read-only against Airtable — never modifies or deletes any
 * record. Intended to run on a schedule (see POST /backup-airtable) so a
 * point-in-time restore reference always exists, since Airtable revision
 * history is not enabled on this base.
 *
 * @returns {Promise<{ url: string, recordCount: number }>}
 */
export async function backupAirtable() {
  const snapshot = await buildAirtableSnapshot();
  const filename = `airtable-backup_${snapshot.exportedAt.slice(0, 10)}_${Date.now()}.json`;
  const url = await uploadRawToCdn(JSON.stringify(snapshot, null, 2), filename);

  return { url, recordCount: snapshot.recordCount };
}

/**
 * Runs backupAirtable() and sends a confirmation or failure email.
 * Called by POST /backup-airtable and scripts/backup-airtable.js.
 *
 * @returns {Promise<{ url: string, recordCount: number }>}
 */
export async function runBackupWithAlert() {
  try {
    const result = await backupAirtable();
    await sendBackupConfirmation(result).catch(() => {});
    return result;
  } catch (err) {
    await sendBackupFailureAlert({ error: err }).catch(() => {});
    throw err;
  }
}
