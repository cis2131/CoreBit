# CoreBit Network Manager - Docker Image
# Multi-stage build for optimized production image

#===============================================================================
# Stage 1: Build
#===============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ git

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .

# Build frontend
RUN npm run build

# Build backend (production bundle)
RUN npx esbuild server/index.prod.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/index.js

#===============================================================================
# Stage 2: Production
#===============================================================================
FROM node:20-alpine AS production

LABEL org.opencontainers.image.source=https://github.com/corebit/corebit
LABEL org.opencontainers.image.description="CoreBit Network Manager - Modern network topology and monitoring"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    iputils \
    net-snmp-tools \
    && rm -rf /var/cache/apk/*

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Copy built files from builder stage
COPY --from=builder /app/dist/public ./dist/public
COPY --from=builder /app/dist/index.js ./dist/index.js

# Copy version file
COPY version.json ./

# Copy Drizzle files for migrations
COPY drizzle.config.ts ./
COPY drizzle ./drizzle
COPY shared/schema.ts ./shared/

# Create directories for data persistence
RUN mkdir -p /app/data /app/backups

# Create non-root user
RUN addgroup -g 1001 -S corebit && \
    adduser -S -u 1001 -G corebit corebit && \
    chown -R corebit:corebit /app

# Note: We run as root by default for network operations (ICMP ping, SNMP)
# If you don't need these features, you can add: USER corebit

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Expose application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]
