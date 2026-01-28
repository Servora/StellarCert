Development environment with Docker Compose

This project includes a docker-compose setup for local development. It starts:
- PostgreSQL (postgres:15-alpine)
- Redis (redis:7-alpine)
- Backend (NestJS) with hot-reload
- Frontend (Vite) with hot-reload

Files added/changed
- `docker-compose.yml` — added Redis service, env_file usage, and hot-reload-friendly mounts
- `backend/Dockerfile` — kept development stage running as root to avoid permission issues with mounted volumes
- `.env.dev` / `.env` — development environment variables used by Docker Compose

Quick start (macOS / Linux)

1. Ensure Docker Desktop is running.
2. From repository root run:

```bash
# build images and start services
docker compose up --build
```

3. Open the frontend at http://localhost:5173 and backend at http://localhost:3000

Notes
- The frontend inside the container talks to the backend using the service name `http://backend:3000/api` (this is set in `.env` / `.env.dev`).
- The backend expects `DATABASE_URL` and `REDIS_URL` to be set (already provided in `.env` for development). If you change credentials, update `.env` and `docker-compose.yml` accordingly.
- If you encounter permission errors with node_modules when using volume mounts, remove the `- /app/node_modules` anonymous volume and run `npm ci` inside the container once.

Advanced
- To run only backend and database:

```bash
docker compose up --build backend postgres redis
```

- To run in detached mode:

```bash
docker compose up --build -d
```

Cleanup

```bash
docker compose down -v
```

If you'd like, I can also:
- Add a small healthcheck script or wait-for script to the backend to ensure DB/Redis are reachable before starting the Nest app.
- Add a Makefile or npm script to simplify docker commands.
