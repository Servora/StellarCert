# Dependencies stage for building
FROM node:26-alpine AS deps

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 g++ make

COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Build stage
FROM node:26-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY . .
RUN npm run build

# Production dependencies stage
FROM node:26-alpine AS prod-deps

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 g++ make

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Production runtime stage (no build tools / compilers)
FROM node:26-alpine AS production

WORKDIR /app

COPY package*.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY src/modules/email/templates ./dist/modules/email/templates

# Copy entrypoint — runs migrations then starts the app
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

RUN addgroup -g 1001 -S nodejs \
  && adduser -S nodejs -u 1001 -G nodejs
USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
