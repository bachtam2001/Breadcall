# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY server/ ./server/
COPY client/ ./client/
COPY build.js ./
COPY public/ ./public/

# Build production assets
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

# Install wget for health check
RUN apk add --no-cache wget

# Create non-root user (node user already exists in node:20-alpine with UID 1000)
# Just need to ensure proper permissions

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force && \
    rm -rf /tmp/*

# Copy built assets from builder stage
COPY --from=builder /app/public ./public
COPY --from=builder /app/server ./server

# Create logs directory with correct permissions
RUN mkdir -p logs && chown -R node:node /app

# Switch to non-root user
USER node

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Set environment
ENV NODE_ENV=production

# Start server
CMD ["node", "server/src/index.js"]
