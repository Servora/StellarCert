# -----------------------------------------------------------------------------
# Development stage
# -----------------------------------------------------------------------------
FROM node:20-alpine AS development

WORKDIR /app

# Install dependencies (cached layer)
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

EXPOSE 3000

# Run Vite dev server for local development
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]

# -----------------------------------------------------------------------------
# Build stage
# -----------------------------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
# Production stage (non-root, static file server)
# -----------------------------------------------------------------------------
# Use unprivileged NGINX image so the container does not run as root.
FROM nginxinc/nginx-unprivileged:stable-alpine AS production

ENV NODE_ENV=production

# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Custom nginx configuration optimized for SPA + security headers
COPY nginx.conf /etc/nginx/conf.d/default.conf

# nginx-unprivileged listens on 8080 by default
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
