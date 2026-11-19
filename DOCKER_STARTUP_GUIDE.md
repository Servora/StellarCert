# StellarCert Docker Startup Guide

## Quick Start

To start the entire StellarCert application using Docker Compose:

```bash
# Start all services in development mode
docker-compose up --build

# Start services in detached mode (run in background)
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Stop and remove volumes (clean restart)
docker-compose down -v
```

## Service URLs

Once all services are running, you can access:

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000
- **Health Check**: http://localhost:3000/api/v1/health
- **Metrics**: http://localhost:3000/metrics (if enabled)

## Optional Services

### Production Mode (with Nginx)

```bash
# Start with Nginx reverse proxy
docker-compose --profile production up --build
```

### Monitoring (with Prometheus)

```bash
# Start with Prometheus monitoring
docker-compose --profile monitoring up --build
```

### Production + Monitoring

```bash
# Start with both Nginx and Prometheus
docker-compose --profile production --profile monitoring up --build
```

## Environment Configuration

### Required Environment Variables

Create a `.env` file in the project root with the following variables:

```bash
# Stellar Configuration
STELLAR_ISSUER_SECRET_KEY=your_stellar_secret_key_here
STELLAR_ISSUER_PUBLIC_KEY=your_stellar_public_key_here

# JWT Configuration
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRES_IN=3600

# Optional: Sentry for error tracking
SENTRY_DSN=https://your_sentry_dsn@sentry.io/project_id

# Optional: Email configuration
EMAIL_SERVICE=smtp
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USERNAME=your_email@example.com
EMAIL_PASSWORD=your_email_password
EMAIL_FROM=noreply@example.com
```

### Using the Example Environment File

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your specific configuration
```

## Service Dependencies

The services start in the following order:

1. **PostgreSQL** - Database service
2. **Redis** - Cache and job queue service
3. **Backend** - API service (waits for database and Redis)
4. **Frontend** - Web application (waits for backend)

## Database Migrations

TypeORM migrations are run automatically by the backend container on every
startup. The flow is:

1. Docker Compose waits for the Postgres health-check to pass (`pg_isready`).
2. The backend container starts and executes `docker-entrypoint.sh`.
3. The script runs `typeorm migration:run -d dist/database/data-source.js`,
   applying any pending migrations in timestamp order.
4. If migrations succeed the NestJS application starts normally.
5. If migrations fail the container exits with a non-zero code, keeping the
   app offline until the issue is resolved — no silent schema mismatch.

**Why not the Postgres `initdb.d` directory?**  
The Postgres image only executes top-level `.sql` and `.sh` files in
`/docker-entrypoint-initdb.d/` and only on the very first container startup
(empty data volume). TypeORM migrations are TypeScript source files, not SQL,
and nesting them inside a subdirectory means the image ignores them entirely.
Running migrations from the backend container is the correct approach.

**Running migrations manually** (e.g. after a hotfix):

```bash
# Build first so dist/database/data-source.js exists
docker-compose exec backend sh -c "node node_modules/.bin/typeorm migration:run -d dist/database/data-source.js"

# Roll back the last migration
docker-compose exec backend sh -c "node node_modules/.bin/typeorm migration:revert -d dist/database/data-source.js"

# Show migration status
docker-compose exec backend sh -c "node node_modules/.bin/typeorm migration:show -d dist/database/data-source.js"
```

**Generating a new migration** (local dev, not inside Docker):

```bash
cd backend
npm run build
npm run migration:generate -- src/database/migrations/MyDescriptiveName
```

## Troubleshooting

### Common Issues

1. **Port conflicts**: Ensure ports 5432, 6379, 3000, and 5173 are available
2. **Environment variables**: Check that all required environment variables are set
3. **Database migrations**: The backend container runs `typeorm migration:run`
   automatically on every startup via `docker-entrypoint.sh`. Migrations are
   idempotent — already-applied migrations are skipped. If migrations fail the
   container exits with a non-zero code and Docker will not start the app
   process, making the failure visible in the logs.

### Reset Everything

```bash
# Stop all services
docker-compose down

# Remove all volumes (this will delete your data)
docker-compose down -v

# Remove all images
docker-compose down --rmi all

# Start fresh
docker-compose up --build
```

### View Service Status

```bash
# Check service status
docker-compose ps

# View logs for a specific service
docker-compose logs backend
docker-compose logs frontend
docker-compose logs postgres
docker-compose logs redis

# Follow logs in real-time
docker-compose logs -f backend
```

## Development Workflow

### Making Changes

1. **Frontend changes**: The frontend container will automatically reload
2. **Backend changes**: You may need to restart the backend service:
   ```bash
   docker-compose restart backend
   ```
3. **Database changes**: You may need to rebuild:
   ```bash
   docker-compose up --build --force-recreate backend
   ```

### Database Access

```bash
# Connect to PostgreSQL
docker-compose exec postgres psql -U stellarwave_user -d stellarwave

# Connect to Redis
docker-compose exec redis redis-cli
```

## Production Deployment

For production deployment:

1. Set `NODE_ENV=production` in your `.env` file
2. Use the production profile:
   ```bash
   docker-compose --profile production up -d
   ```
3. Configure SSL certificates in the `nginx/ssl` directory
4. Update the `nginx/nginx.conf` file with your domain configuration

## Health Checks

Each service has built-in health checks:

- **PostgreSQL**: Checks database connectivity
- **Redis**: Pings the Redis server
- **Backend**: Checks `/api/v1/health` endpoint
- **Frontend**: Checks if the web server is responding

Services will only start after their dependencies are healthy.
