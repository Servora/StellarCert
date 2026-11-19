#!/bin/sh
# docker-entrypoint.sh
# Runs TypeORM migrations against the configured database, then starts the
# NestJS application. The migrations are executed from the compiled JS output
# (dist/) so this script must run AFTER `npm run build`.
#
# Environment variables expected (all have defaults matching docker-compose.yml):
#   DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME

set -e

echo "[entrypoint] Running TypeORM migrations…"
node node_modules/.bin/typeorm migration:run -d dist/database/data-source.js
echo "[entrypoint] Migrations complete."

echo "[entrypoint] Starting application…"
exec node dist/main
