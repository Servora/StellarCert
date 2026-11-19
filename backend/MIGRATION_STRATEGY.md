# Database Migration Strategy

## Overview

StellarCert uses **TypeORM**. This document defines how migrations are managed
across environments so that `synchronize: true` is **never used in production**.

---

## Environment Rules

| Environment | `synchronize` | Migration source |
|-------------|---------------|-----------------|
| development | `false`       | `npm run migration:run` |
| test        | `false`       | `npm run migration:run` |
| production  | `false`       | `npm run migration:run` |

> **Important:** `synchronize: true` auto-alters tables on start-up and can
> cause irreversible data loss. It must remain `false` in all environments.

---

## The application never synchronizes

`synchronize` is hard-coded to `false` in `backend/src/config/typeorm.config.ts`
and is no longer read from the environment, so it cannot be switched on by
accident. Two reasons:

1. The data-loss risk described above.
2. `synchronize` is the only step TypeORM performs during `initialize()` that
   issues **concurrent queries on a single pooled client** — the schema
   comparison fans out over tables, columns and drifted indexes with
   `Promise.all`. That is what makes `pg` print
   `Calling client.query() when the client is already executing a query is
   deprecated`, which becomes a hard error in `pg@9`, and the application
   cannot serialise it because it happens inside TypeORM (#956).

`TYPEORM_SYNCHRONIZE` is therefore ignored: when it is set to `true` the app
logs a warning at boot and continues with `synchronize: false`. It also no
longer disables `migrationsRun`, so migrations always remain the schema source.

### Who applies the schema

| Context | Who runs the migrations |
| ------- | ----------------------- |
| Docker / Compose | `docker-entrypoint.sh` — `typeorm migration:run -d dist/database/data-source.js` before `node dist/main` |
| Local development | `npm run migration:run` |
| CI | `npm run migration:run` against the CI database |

The application connects and serves; it does not own the schema. `migrationsRun`
in the Nest configuration uses the same migrations, so a fresh database is
provisioned on boot where no entrypoint runs first.

---

## Workflow

### 1. Generate a migration after entity changes

```bash
npm run migration:generate -- src/database/migrations/<MigrationName>
```

TypeORM diffs the current schema against the compiled entities and produces a
timestamped migration file.

### 2. Review the generated file

Check `src/database/migrations/<timestamp>-<MigrationName>.ts` for:
- Unintended `DROP` or `ALTER` statements.
- Missing index creation.
- Correct `up()` and matching `down()` rollback.

### 3. Run migrations locally

```bash
npm run migration:run
```

### 4. Rollback if needed

```bash
npm run migration:revert
```

---

## CI Check

The CI pipeline runs the following step on every pull request that touches
`backend/src/**`:

```yaml
- name: Check pending migrations
  run: |
    npm run migration:generate -- src/database/migrations/ci-check --check
```

The `--check` flag exits with a non-zero code when entity changes exist that
have no corresponding migration file, failing the build before deployment.

---

## Naming Convention

```
<timestamp>-<PascalCaseDescription>.ts
```

Example: `1714000000000-AddVerificationTokenToUser.ts`

---

## Scripts (package.json)

```json
{
  "migration:generate": "typeorm migration:generate -d src/database/data-source.ts",
  "migration:run":      "typeorm migration:run      -d src/database/data-source.ts",
  "migration:revert":   "typeorm migration:revert   -d src/database/data-source.ts",
  "migration:show":     "typeorm migration:show     -d src/database/data-source.ts"
}
```
