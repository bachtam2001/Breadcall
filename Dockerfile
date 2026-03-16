# Signaling Server Dockerfile
FROM node:20-alpine

# Install dependencies
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev deps for build)
RUN npm ci

# Copy source code
COPY server/ ./server/
COPY client/ ./client/
COPY build.js ./

# Build JavaScript for production
RUN npm run build

# Copy HTML and CSS files to public directory
COPY public/*.html /app/public/
COPY public/css/ /app/public/css/

# Remove dev dependencies to reduce image size
RUN npm ci --only=production && npm prune --production

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Set environment
ENV NODE_ENV=production

# Start server
CMD ["node", "server/src/index.js"]
