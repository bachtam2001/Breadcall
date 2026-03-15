.PHONY: help dev prod stop clean logs build health certs

# Default target
help:
	@echo "BreadCall Docker Commands:"
	@echo ""
	@echo "  make dev       - Start development environment"
	@echo "  make prod      - Start production environment"
	@echo "  make stop      - Stop all containers"
	@echo "  make clean     - Remove containers and volumes"
	@echo "  make logs      - View logs"
	@echo "  make build     - Build all images"
	@echo ""

# Development
dev:
	docker compose up --build -d
	@echo "Services started:"
	@echo "  - Signaling: http://localhost:3000"
	@echo "  - Web:       http://localhost:80"

# Production
prod:
	docker compose up --build -d

# Stop all services
stop:
	docker compose down

# Clean everything including volumes
clean:
	docker compose down -v
	docker system prune -f

# View logs
logs:
	docker compose logs -f

# Follow specific service logs
logs-signaling:
	docker compose logs -f signaling

logs-web:
	docker compose logs -f web

# Build images
build:
	docker compose build

# Health check
health:
	@echo "Checking signaling server..."
	@curl -s http://localhost:3000/health | jq || echo "Not responding"
	@echo ""
	@echo "Checking web server..."
	@curl -s -o /dev/null -w "%{http_code}" http://localhost:80 || echo "Not responding"
	@echo ""

# Generate self-signed certs (for development TLS)
certs:
	mkdir -p certs
	openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
		-keyout certs/server.key \
		-out certs/server.crt \
		-subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
	@echo "Certificates generated in certs/ folder"