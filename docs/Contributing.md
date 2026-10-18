# Contributing — Local setup and IssuerProfile update

This repo contains backend (NestJS), frontend (Vite + React), and Soroban contracts.

Goal: ensure `IssuerProfile` uses real API data by default and allow optionally using dummy data.

Quick start (development)

1. Start required services (Postgres + Redis) using Docker Compose:

```bash
# from repo root
docker-compose up -d postgres redis
```

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
