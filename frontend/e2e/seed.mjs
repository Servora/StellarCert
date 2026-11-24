// Seeds two pre-verified test accounts directly in Postgres so the
// cross-stack smoke suite can log in without going through email
// verification (there is no mail-capture service in this compose stack).
// Idempotent: safe to run against an already-seeded database.
import pg from 'pg';
import { pathToFileURL } from 'node:url';

const {
  E2E_DB_HOST = 'localhost',
  E2E_DB_PORT = '5433',
  E2E_DB_USER = 'stellarwave_user',
  E2E_DB_PASSWORD = 'stellarwave_password',
  E2E_DB_NAME = 'stellarwave',
} = process.env;

// Precomputed with bcryptjs (12 rounds, the same algorithm and cost the
// backend uses) for the password 'E2eTest!Passw0rd'. Recompute with
// `node -e "require('bcryptjs').hash('...', 12).then(console.log)"` if the
// password below is ever changed.
const PASSWORD_HASH =
  '$2b$12$YGvFcuYCf5HX2JsLKpu/1O9ascXBLxOjD0GhjpDSe14aGTlq2zD2q';

export const E2E_USERS = {
  issuer: {
    email: 'e2e-issuer@example.test',
    password: 'E2eTest!Passw0rd',
    firstName: 'E2E',
    lastName: 'Issuer',
    role: 'issuer',
  },
  recipient: {
    email: 'e2e-recipient@example.test',
    password: 'E2eTest!Passw0rd',
    firstName: 'E2E',
    lastName: 'Recipient',
    role: 'user',
  },
};

async function seedUser(client, user) {
  await client.query(
    `INSERT INTO users (email, password, "firstName", "lastName", role, status, "isEmailVerified", "isActive")
     VALUES ($1, $2, $3, $4, $5, 'active', true, true)
     ON CONFLICT (email) DO UPDATE SET
       password = EXCLUDED.password,
       role = EXCLUDED.role,
       status = EXCLUDED.status,
       "isEmailVerified" = EXCLUDED."isEmailVerified",
       "isActive" = EXCLUDED."isActive"`,
    [user.email, PASSWORD_HASH, user.firstName, user.lastName, user.role],
  );
}

export async function seedAll() {
  const client = new pg.Client({
    host: E2E_DB_HOST,
    port: Number(E2E_DB_PORT),
    user: E2E_DB_USER,
    password: E2E_DB_PASSWORD,
    database: E2E_DB_NAME,
  });
  await client.connect();
  try {
    await seedUser(client, E2E_USERS.issuer);
    await seedUser(client, E2E_USERS.recipient);
    console.log(
      `Seeded e2e test users: ${E2E_USERS.issuer.email}, ${E2E_USERS.recipient.email}`,
    );
  } finally {
    await client.end();
  }
}

// Only run automatically when invoked directly (not when imported by globalSetup).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedAll().catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
}
