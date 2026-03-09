# BreadCall SRT Gateway
# Docker image with FFmpeg compiled with SRT support

FROM node:18-bullseye

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    pkg-config \
    libssl-dev \
    libsrt-openssl-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Create directory for any temporary files
RUN mkdir -p /tmp

# Expose ports
# 8080 - HTTP API
# 9000-9100 - SRT listener ports (UDP)
EXPOSE 8080
EXPOSE 9000-9100/udp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV SRT_PORT_RANGE=9000-9100

# Start the gateway
CMD ["node", "src/index.js"]
