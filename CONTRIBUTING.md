# Contributing — Local setup and IssuerProfile update

This repo contains backend (NestJS), frontend (Vite + React), and Soroban contracts.

Goal: ensure `IssuerProfile` uses real API data by default and allow optionally using dummy data.

Quick start (development)

1. Start the services the backend depends on (Postgres + Redis) using the
   dependencies-only compose target:

```bash
# from repo root — starts Postgres on 5432 and Redis on 6379 and returns
# only once both report healthy
npm run dev:deps
```

This uses `docker-compose.dev.yml`, which contains **only** Postgres and Redis,
so it does not build the backend/frontend images the full `docker-compose.yml`
stack needs. The two files describe the same containers and volumes (same
project, same credentials, same ports), so you can switch between
`npm run dev:deps` and `docker-compose up` without duplicating data.

| Command                 | What it does                                  |
| ----------------------- | --------------------------------------------- |
| `npm run dev:deps`      | Start Postgres + Redis, wait until healthy    |
| `npm run dev:deps:logs` | Follow their logs                             |
| `npm run dev:deps:down` | Stop them (data is kept in the named volumes) |

Requires Docker Compose v2 (`docker-compose` as shipped with Docker Desktop).
To wipe the data and start from an empty database, run
`docker-compose -f docker-compose.dev.yml down -v`.

2. Build and run the backend (recommended in a separate terminal). Provide required env vars — at minimum the backend requires `JWT_SECRET` and DB connection info. Example `.env` values:

```bash
# Example env (create .env or export in shell)
export NODE_ENV=development
export PORT=3000
export DB_HOST=localhost
export DB_PORT=5432
export DB_USERNAME=stellarwave_user
export DB_PASSWORD=stellarwave_password
export DB_NAME=stellarwave
export JWT_SECRET=dev-secret
export JWT_EXPIRES_IN=24h
export ALLOWED_ORIGINS=http://localhost:5173
```

Then start the backend:

```bash
cd backend
npm install
npm run start:dev
```

3. Start frontend (defaults to real API). In a new terminal:

```bash
cd frontend
# Use real API (default)
VITE_USE_DUMMY_DATA=false npm run dev

# To run with dummy data for offline dev
VITE_USE_DUMMY_DATA=true npm run dev
```

Notes and verification

- The backend defaults line up with what `npm run dev:deps` starts, so the fast loop needs no connection env vars beyond the ones above: `DB_HOST`/`DB_PORT`/`DB_USERNAME`/`DB_PASSWORD`/`DB_NAME` fall back to `localhost:5432` and the `stellarwave_user`/`stellarwave` credentials reserved by `docker-compose.dev.yml` (`backend/src/config/typeorm.config.ts`), and Redis falls back to `localhost:6379` when `REDIS_URL` is unset (`backend/src/app.module.ts`).
- The frontend reads `VITE_USE_DUMMY_DATA` to decide whether to use hardcoded mock data or call real API endpoints. This was changed to default to `false` (real API) — see `frontend/src/api/endpoints.ts`.
- Frontend expects backend API at `VITE_API_URL` (defaults to `http://localhost:3000/api/v1`). Set `VITE_API_URL` in your environment or `.env` if your backend runs on a different host/port.
- Ensure you have an issuer account and valid JWT; the frontend uses `tokenStorage` to attach the Authorization header.

Testing and CI

- The repository contains backend e2e tests (`backend/test`) and a CI workflow `.github/workflows/ci.yml`.
- Consider adding frontend tests for `IssuerProfile` to cover API integration and rendering.

Branch and PR

- I created branch `feat/issuerprofile-real-stats` which includes the change to respect `VITE_USE_DUMMY_DATA`.
- To push and open a PR:

```bash
git push -u origin feat/issuerprofile-real-stats
# then open a PR on GitHub
```

If you'd like, I can:

- Start backend+frontend locally here to verify the `IssuerProfile` page (requires setting `JWT_SECRET` and creating a test issuer user), or
- Add a small integration test to the frontend that mocks `issuerProfileApi` and ensures `IssuerProfile` renders fetched data.

Tell me which you'd prefer and I'll proceed.
