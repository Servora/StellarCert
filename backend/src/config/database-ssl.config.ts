import type { ConnectionOptions } from 'tls';

/**
 * Builds the PostgreSQL SSL option understood by TypeORM/pg.
 *
 * Node's TLS default is to verify server certificates. Deliberately leave
 * `rejectUnauthorized` unset so a configured CA is used for verification and
 * TLS is never weakened here.
 */
export function databaseSslOptions(env: NodeJS.ProcessEnv = process.env): {
  ssl?: boolean | ConnectionOptions;
} {
  const sslValue = env.DB_SSL?.trim().toLowerCase();
  const ca = env.DB_SSL_CA?.trim();

  if (!sslValue) {
    if (ca) {
      throw new Error('DB_SSL_CA requires DB_SSL=true.');
    }
    return {};
  }

  if (sslValue !== 'true' && sslValue !== 'false') {
    throw new Error('DB_SSL must be either true or false.');
  }

  if (sslValue === 'false') {
    if (ca) {
      throw new Error('DB_SSL_CA requires DB_SSL=true.');
    }
    return {};
  }

  return {
    ssl: ca
      ? {
          // Environment managers often represent PEM newlines as `\\n`.
          ca: ca.replace(/\\n/g, '\n'),
        }
      : true,
  };
}
