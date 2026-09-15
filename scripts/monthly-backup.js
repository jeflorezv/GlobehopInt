/**
 * Monthly backup: Airtable snapshot to Cloudinary + a dated copy committed
 * into this repo, plus an audit for untracked local-only assets (the
 * failure mode that lost assets/music/'s 27 tracks in Sept 2026 — present
 * on disk, never committed, discovered only by accident months later).
 *
 * Run manually any time, or on a schedule via a monthly cloud agent (see
 * CLAUDE.md) — not a Railway endpoint, since pushing to GitHub needs git
 * credentials the production container doesn't have.
 *
 * Usage: node scripts/monthly-backup.js
 */
import 'dotenv/config';
import { runMonthlyBackupWithAlert } from '../src/monthly-backup.js';

const { recordCount, cloudinaryUrl, commitSha, newlyTrackedFiles, flaggedFiles } = await runMonthlyBackupWithAlert();

console.log(`✓ Backed up ${recordCount} Airtable records`);
console.log(`  Cloudinary: ${cloudinaryUrl}`);
console.log(`  Git commit: ${commitSha ?? '(no changes to commit)'}`);
if (newlyTrackedFiles.length) {
  console.log(`  Newly tracked assets: ${newlyTrackedFiles.join(', ')}`);
}
if (flaggedFiles.length) {
  console.log(`  ⚠️  Flagged for manual review (untracked, not auto-committed): ${flaggedFiles.join(', ')}`);
}
