// Playwright global setup: seeds the pre-verified test accounts the smoke
// suite logs in as. Safe to re-run (upserts by email).
import { seedAll } from './seed.mjs';

export default async function globalSetup() {
  await seedAll();
}
