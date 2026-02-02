# Multi-stage build for Docker Simple Secrets

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install all dependencies (including dev dependencies for build)
COPY package*.json ./
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Install production dependencies only
RUN npm ci --only=production

# Stage 2: Production
FROM node:20-alpine
LABEL org.opencontainers.image.source https://github.com/thiccdata-io/docker-simple-secrets

# Install GPG for encryption/decryption
RUN apk add --no-cache gnupg curl

WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copy entrypoint script from source
COPY src/dss-entrypoint-wrapper.sh ./dist/dss-entrypoint-wrapper.sh

# Copy static files and views
COPY static ./static
COPY views ./views

# Set environment to production
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/healthz', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Start the application
CMD ["node", "dist/server.js"]
