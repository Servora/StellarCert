# Build stage
FROM node:26-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 g++ make

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

# Production stage
FROM node:26-alpine AS production

WORKDIR /app

RUN apk add --no-cache python3 g++ make

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY src/modules/email/templates ./dist/modules/email/templates

# Copy entrypoint — runs migrations then starts the app
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

RUN addgroup -g 1001 -S nodejs \
  && adduser -S nodejs -u 1001 -G nodejs
USER nodejs

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
