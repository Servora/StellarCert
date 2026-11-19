/**
 * Soroban test snapshot freshness checker.
 * Addresses issue #423: Test snapshots may be outdated.
 *
 * Reads the snapshot file and the contract source files, then compares
 * modification timestamps. If any contract source is newer than the snapshot,
 * the snapshot is considered stale and the script exits with a non-zero code
 * so CI fails with a clear message.
 */

import { statSync, readdirSync } from 'fs';
import { join, extname } from 'path';

const SNAPSHOT_PATH = join(
  __dirname,
  '../../../stellar-contracts/test_snapshots/test',
);
const CONTRACT_SRC_PATH = join(__dirname, '../../../stellar-contracts/src');

function getLatestMtime(dir: string, ext: string): number {
  let latest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && extname(entry.name) === ext) {
      const mtime = statSync(join(dir, entry.name)).mtimeMs;
      if (mtime > latest) latest = mtime;
    }
  }
  return latest;
}

function getOldestSnapshotMtime(dir: string): number {
  let oldest = Infinity;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      const mtime = statSync(join(dir, entry.name)).mtimeMs;
      if (mtime < oldest) oldest = mtime;
    }
  }
  return oldest === Infinity ? 0 : oldest;
}

function checkSnapshotFreshness(): void {
  const latestContractChange = getLatestMtime(CONTRACT_SRC_PATH, '.rs');
  const oldestSnapshot = getOldestSnapshotMtime(SNAPSHOT_PATH);

  if (latestContractChange === 0) {
    console.warn('No Rust source files found in', CONTRACT_SRC_PATH);
    process.exit(0);
  }

  if (oldestSnapshot === 0) {
    console.error('No snapshot JSON files found in', SNAPSHOT_PATH);
    process.exit(1);
  }

  if (latestContractChange > oldestSnapshot) {
    console.error(
      'Soroban test snapshots are outdated.\n' +
        'Contract sources were modified after the snapshots were generated.\n' +
        'Run `cargo test -- --update-snapshots` to regenerate them.',
    );
    process.exit(1);
  }

  console.log('Soroban test snapshots are up to date.');
}

checkSnapshotFreshness();
