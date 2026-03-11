#!/bin/bash
# BreadCall Docker Run Script
# Quick start script for running BreadCall with Docker

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           BreadCall - Docker Setup                     ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠ Creating .env from .env.example...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✓ Created .env file${NC}"
    echo -e "${YELLOW}  Please edit .env and set EXTERNAL_IP to your server's public IP${NC}"
    echo ""
fi

# Check if nimble.conf exists
if [ ! -f docker/nimble/nimble.conf ]; then
    echo -e "${RED}✗ nimble.conf not found!${NC}"
    echo "  Expected location: docker/nimble/nimble.conf"
    exit 1
fi
echo -e "${GREEN}✓ nimble.conf found${NC}"

# Check if nginx.conf exists
if [ ! -f docker/nginx/nginx.conf ]; then
    echo -e "${RED}✗ nginx.conf not found!${NC}"
    echo "  Expected location: docker/nginx/nginx.conf"
    exit 1
fi
echo -e "${GREEN}✓ nginx.conf found${NC}"

# Function to check if a port is available
check_port() {
    local port=$1
    if command -v lsof &> /dev/null; then
        if lsof -i:$port &> /dev/null; then
            echo -e "${RED}✗ Port $port is already in use${NC}"
            return 1
        fi
    fi
    return 0
}

# Check critical ports
echo ""
echo -e "${YELLOW}Checking ports...${NC}"
check_port 80 || echo "  Consider stopping other services on port 80"
check_port 8082 || echo "  Consider stopping other services on port 8082"

# Pull latest images
echo ""
echo -e "${YELLOW}Pulling latest Docker images...${NC}"
docker compose pull nimble
docker compose pull web

# Start services
echo ""
echo -e "${YELLOW}Starting BreadCall services...${NC}"
docker compose up -d

# Wait for services to be ready
echo ""
echo -e "${YELLOW}Waiting for services to start...${NC}"
sleep 10

# Check service health
echo ""
echo -e "${YELLOW}Checking service health...${NC}"

# Check signaling server
if curl -s http://localhost:${SIGNALING_PORT:-3000}/health | grep -q "ok"; then
    echo -e "${GREEN}✓ Signaling server is healthy${NC}"
else
    echo -e "${RED}✗ Signaling server health check failed${NC}"
fi

# Check Nimble
if docker compose ps nimble | grep -qi "up"; then
    echo -e "${GREEN}✓ Nimble Streamer is running${NC}"
else
    echo -e "${RED}✗ Nimble Streamer is not running${NC}"
fi

# Check nginx
if docker compose ps web | grep -qi "up"; then
    echo -e "${GREEN}✓ Web frontend is running${NC}"
else
    echo -e "${RED}✗ Web frontend is not running${NC}"
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  BreadCall is now running!                             ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Web Interface: http://localhost                       ║${NC}"
echo -e "${GREEN}║  Signaling:     ws://localhost:${SIGNALING_PORT:-3000}/ws          ║${NC}"
echo -e "${GREEN}║  Nimble Management: http://localhost:8082/manage       ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Useful commands:${NC}"
echo "  docker compose logs -f          # View all logs"
echo "  docker compose logs signaling   # View signaling logs"
echo "  docker compose logs nimble      # View Nimble logs"
echo "  docker compose down             # Stop all services"
echo ""
