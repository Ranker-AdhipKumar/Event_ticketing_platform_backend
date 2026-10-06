# ==============================================================================
# Multi-stage Dockerfile for Event Ticketing Platform Backend
# ==============================================================================

# Stage 1: Build & Compile TypeScript
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Stage 2: Production Runtime
FROM node:22-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled files and SQL schema from builder stage
COPY --from=builder /usr/src/app/dist ./dist

# Create directory for SQLite storage (if SQLite mode is active)
RUN mkdir -p /usr/src/app/data && chown -R node:node /usr/src/app

# Switch to non-root user for enhanced security
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
