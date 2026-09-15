import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { buildAirtableSnapshot } from './backup-airtable.js';
import { uploadRawToCdn } from './upload-cdn.js';
import { sendMonthlyBackupConfirmation, sendMonthlyBackupFailureAlert } from './send-alert.js';

const execFileAsync = promisify(execFile);

// Resolved from this file's own location, not process.cwd() — this module
// may run from a scheduled agent whose working directory isn't guaranteed
// to be the repo root (see CLAUDE.md's cwd-dependent-path lesson from the
// Veo migration testing).
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP_DIR   = path.join(PROJECT_ROOT, 'backups', 'airtable');

// Only files under assets/ with a known-safe media/font extension are ever
// auto-committed — this is deliberately narrow. It targets exactly the
// failure mode that lost assets/music/ (a binary asset living on disk but
// never tracked in git), without blindly `git add`-ing arbitrary untracked
// files repo-wide, which could ship something that was never meant to be
// committed (a stray credentials file, a WIP scratch file). Anything else
// untracked is reported in the backup email for a human to review, never
// auto-committed.
const SAFE_ASSET_EXTENSIONS = new Set([
  '.mp3', '.m4a', '.aac', '.wav',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.ttf', '.otf', '.woff', '.woff2',
  '.mp4', '.mov',
]);

/**
 * Monthly backup: snapshots Airtable (to Cloudinary, same as the existing
 * biweekly backup, plus now also as a dated JSON file committed into this
 * repo), and audits the working tree for untracked local-only assets —
 * the exact failure mode that lost assets/music/'s 27 tracks in Sept 2026
 * (present on disk, never committed, no backup covered it, gone once the
 * only container that happened to have them was replaced).
 *
 * Read-only against Airtable. Only ever commits: the dated Airtable
 * snapshot, and untracked assets/ files with a recognized media/font
 * extension — see SAFE_ASSET_EXTENSIONS. Everything else untracked is
 * flagged in the confirmation email, never auto-committed.
 *
 * @returns {Promise<{
 *   recordCount: number,
 *   cloudinaryUrl: string,
 *   commitSha: string|null,
 *   newlyTrackedFiles: string[],
 *   flaggedFiles: string[],
 * }>}
 */
export async function runMonthlyBackup() {
  const snapshot = await buildAirtableSnapshot();
  const dateStamp = snapshot.exportedAt.slice(0, 10);
  const snapshotJson = JSON.stringify(snapshot, null, 2);

  await mkdir(BACKUP_DIR, { recursive: true });
  const gitFilePath = path.join(BACKUP_DIR, `${dateStamp}.json`);
  await writeFile(gitFilePath, snapshotJson);

  // Kept alongside the existing biweekly Cloudinary backup rather than
  // replacing it — two independent backup destinations is strictly safer
  // than one, and this doesn't touch that existing schedule.
  const cloudinaryUrl = await uploadRawToCdn(snapshotJson, `airtable-backup_${dateStamp}_monthly.json`);

  // Stage the snapshot file BEFORE scanning for untracked assets, so it
  // (and the otherwise-untracked backups/ directory it lives in) doesn't
  // spuriously show up in its own "flagged for manual review" list.
  const relativeSnapshotPath = path.relative(PROJECT_ROOT, gitFilePath);
  await git(['add', relativeSnapshotPath]);

  const { newlyTrackedFiles, flaggedFiles } = await findUntrackedAssets();
  if (newlyTrackedFiles.length) await git(['add', ...newlyTrackedFiles]);

  let commitSha = null;
  if (await hasStagedChanges()) {
    const message = buildCommitMessage({ dateStamp, recordCount: snapshot.recordCount, newlyTrackedFiles });
    await git(['commit', '-m', message]);
    const { stdout } = await git(['rev-parse', 'HEAD']);
    commitSha = stdout.trim();
    await git(['push']);
  }

  return { recordCount: snapshot.recordCount, cloudinaryUrl, commitSha, newlyTrackedFiles, flaggedFiles };
}

/**
 * Runs runMonthlyBackup() and sends a confirmation or failure email.
 * Called by scripts/monthly-backup.js and the monthly scheduled agent.
 */
export async function runMonthlyBackupWithAlert() {
  try {
    const result = await runMonthlyBackup();
    await sendMonthlyBackupConfirmation(result).catch(() => {});
    return result;
  } catch (err) {
    await sendMonthlyBackupFailureAlert({ error: err }).catch(() => {});
    throw err;
  }
}

async function findUntrackedAssets() {
  const { stdout } = await git(['status', '--porcelain']);
  const untracked = stdout
    .split('\n')
    .filter(line => line.startsWith('??'))
    .map(line => line.slice(3).trim())
    .filter(Boolean);

  const newlyTrackedFiles = [];
  const flaggedFiles = [];

  for (const file of untracked) {
    const ext = path.extname(file).toLowerCase();
    if (file.startsWith('assets/') && SAFE_ASSET_EXTENSIONS.has(ext)) {
      newlyTrackedFiles.push(file);
    } else if (file === '.DS_Store' || file.endsWith('.log')) {
      // known noise — never flagged, never committed
    } else {
      flaggedFiles.push(file);
    }
  }

  return { newlyTrackedFiles, flaggedFiles };
}

async function hasStagedChanges() {
  try {
    await execFileAsync('git', ['diff', '--cached', '--quiet'], { cwd: PROJECT_ROOT });
    return false; // exit 0 — nothing staged
  } catch {
    return true; // non-zero exit — there are staged changes
  }
}

async function git(args) {
  return execFileAsync('git', args, { cwd: PROJECT_ROOT, maxBuffer: 10 * 1024 * 1024 });
}

function buildCommitMessage({ dateStamp, recordCount, newlyTrackedFiles }) {
  const lines = [
    `chore: monthly backup ${dateStamp}`,
    '',
    `Airtable snapshot: ${recordCount} records (also uploaded to Cloudinary, same as the existing biweekly backup).`,
  ];
  if (newlyTrackedFiles.length) {
    lines.push(
      '',
      'Newly tracked local-only assets found during this backup\'s untracked-file',
      'audit and committed automatically (see monthly-backup.js SAFE_ASSET_EXTENSIONS):',
      ...newlyTrackedFiles.map(f => `- ${f}`),
    );
  }
  return lines.join('\n');
}
