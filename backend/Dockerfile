# Development Stage
FROM node:18-alpine AS development

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --legacy-peer-deps --silent

# Copy source code
COPY . .
# Note: keep running as root in development to avoid permission issues
# when mounting the project directory from the host for hot-reload.

EXPOSE 3000

CMD ["npm", "run", "start:dev"]

# Production Build Stage
FROM node:18-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install --silent --legacy-peer-deps

COPY . .
RUN npm run build

# Production Stage
FROM node:18-alpine AS production

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps --silent

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3000

CMD ["node", "dist/main"]