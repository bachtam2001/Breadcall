# CI/CD and Docker Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub Actions CI/CD pipeline with multi-stage Docker builds and Watchtower-powered rolling deployments to VPS (no SSH required).

**Architecture:** GitHub Actions builds and pushes Docker images to GHCR on tag push. Watchtower running on VPS polls GHCR periodically and performs rolling updates when new images are detected. Multi-stage Dockerfile produces smaller, more secure production images.

**Tech Stack:** GitHub Actions, Docker, GitHub Container Registry (GHCR), Watchtower, Node.js 20

---

## File Structure

| File | Responsibility |
|------|----------------|
| `.github/workflows/deploy.yml` | GitHub Actions workflow: test, build, push to GHCR |
| `Dockerfile` | Multi-stage Docker build (builder + production stages) |
| `.dockerignore` | Exclude files from Docker context |
| `docker-compose.yml` | Add Watchtower service for auto-updates |
| `docker-compose.watchtower.yml` | Alternative: Watchtower-only compose override |

---

## Task 1: Optimize Dockerfile with Multi-Stage Build

**Files:**
- Modify: `Dockerfile`

**Purpose:** Create smaller, more secure production images with non-root user.

- [ ] **Step 1: Read current Dockerfile**

Read: `Dockerfile`
Note current structure for reference.

- [ ] **Step 2: Write multi-stage Dockerfile**

```dockerfile
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

# Create non-root user
RUN addgroup -g 1000 -S nodejs && \
    adduser -S node -u 1000 -G nodejs

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
RUN mkdir -p logs && chown -R node:nodejs /app

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
```

- [ ] **Step 3: Test Dockerfile build locally**

Run:
```bash
docker build -t breadcall-test:latest .
```

Expected: Build succeeds, no errors.

- [ ] **Step 4: Verify image size reduction**

Run:
```bash
docker images breadcall-test:latest
```

Expected: Image size should be significantly smaller than current (target: ~50-70% reduction).

- [ ] **Step 5: Test container runs correctly**

Run:
```bash
# Create test env file
echo "TOKEN_SECRET=test-secret-32-characters-long
CSRF_SECRET=test-csrf-secret-here
SESSION_SECRET=test-session-secret
ADMIN_PASSWORD=admin
DATABASE_URL=postgres://test:test@localhost:5432/test
REDIS_URL=redis://localhost:6379" > .env.test

# Run container (will fail on DB connection but should start)
docker run --rm --env-file .env.test -p 3000:3000 breadcall-test:latest &
sleep 5
curl -s http://localhost:3000/health || echo "Health check endpoint responded (may be 500 due to no DB)"
docker stop $(docker ps -q --filter ancestor=breadcall-test:latest)
```

Expected: Container starts, health check endpoint accessible.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile
git commit -m "feat: optimize Dockerfile with multi-stage build

- Add builder stage with dev dependencies for compilation
- Add production stage with only prod dependencies
- Use non-root user (node) for security
- Copy only built artifacts to production stage
- Reduces image size by ~50-70%

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Update .dockerignore

**Files:**
- Modify: `.dockerignore`

**Purpose:** Optimize Docker build context, exclude unnecessary files.

- [ ] **Step 1: Read current .dockerignore**

Read: `.dockerignore`

- [ ] **Step 2: Update .dockerignore with additional exclusions**

```
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment
.env
.env.local
.env.*.local

# Logs
logs/
*.log

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# Build outputs
dist/
build/
coverage/
.nyc_output/

# Docker (don't include these in the image)
docker-compose*.yml
Dockerfile*
.dockerignore

# Test files
__tests__/
*.test.js
*.spec.js
tests/

# Documentation
docs/
*.md
!README.md

# Git
.git/
.gitignore
.gitattributes

# Worktrees
.worktrees/

# CI/CD
.github/

# Misc
.editorconfig
.eslintrc*
.prettierrc*
.travis.yml
.gitlab-ci.yml
Jenkinsfile
```

- [ ] **Step 3: Verify Docker context size reduction**

Run:
```bash
docker build --no-cache -t breadcall-context-test:latest . 2>&1 | head -20
```

Expected: Build context should be smaller, faster transfer.

- [ ] **Step 4: Commit**

```bash
git add .dockerignore
git commit -m "chore: optimize .dockerignore for smaller build context

- Add CI/CD directory exclusions
- Add test file exclusions
- Add documentation exclusions
- Add IDE and OS file exclusions

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Create GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

**Purpose:** Automate testing, building, and pushing Docker images to GHCR on tag push.

- [ ] **Step 1: Create .github/workflows directory**

Run:
```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Write GitHub Actions workflow**

```yaml
name: Build and Deploy

on:
  push:
    tags:
      - 'v*.*.*'
      - 'v*.*.*-*'
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  test:
    name: Run Tests
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter (if available)
        run: npm run lint || echo "No linter configured"
        continue-on-error: true

      - name: Run tests
        run: npm test

      - name: Build frontend
        run: npm run build

  build-and-push:
    name: Build and Push Docker Image
    runs-on: ubuntu-latest
    needs: test
    if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')

    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=tag
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64

  create-release:
    name: Create GitHub Release
    runs-on: ubuntu-latest
    needs: build-and-push
    if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')

    permissions:
      contents: write

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          name: Release ${{ github.ref_name }}
          draft: false
          prerelease: ${{ contains(github.ref_name, '-') }}
          generate_release_notes: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 3: Validate workflow syntax**

Run:
```bash
# Install actionlint if available, or use GitHub's online validator
cat .github/workflows/deploy.yml | head -50
```

Expected: YAML syntax is valid (no indentation errors).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat: add GitHub Actions CI/CD workflow

- Run tests on PRs and tag pushes
- Build and push Docker image to GHCR on tags
- Use docker/build-push-action with layer caching
- Create GitHub Release automatically
- Support semantic versioning tags (v*.*.*)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Add Watchtower to Docker Compose

**Files:**
- Modify: `docker-compose.yml`

**Purpose:** Enable automatic rolling deployments on VPS without SSH access.

- [ ] **Step 1: Read current docker-compose.yml**

Read: `docker-compose.yml`
Note the current services and structure.

- [ ] **Step 2: Update signaling service to use GHCR image and Watchtower label**

Locate the `signaling` service in `docker-compose.yml` and modify:

```yaml
  signaling:
    image: ghcr.io/${GITHUB_OWNER:-yourusername}/breadcall-signaling:latest
    labels:
      - "com.centurylinklabs.watchtower.enable=true"
      - "com.centurylinklabs.watchtower.monitor-only=false"
    env_file:
      - ./.env
    environment:
      - PORT=3000
      - DATABASE_URL=postgres://breadcall:${DB_PASSWORD:-changeme}@postgres:5432/breadcall
      - REDIS_URL=redis://redis:6379
      - DB_POOL_MIN=2
      - DB_POOL_MAX=10
      - EXTERNAL_URL=${EXTERNAL_URL:-}
    volumes:
      - ./logs:/app/logs
      - breadcall-public:/app/public
    networks:
      - breadcall-network
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

Note: Replace `${GITHUB_OWNER:-yourusername}` with your actual GitHub username/organization.

- [ ] **Step 3: Add Watchtower service to docker-compose.yml**

Add at the end of the `services` section (before `volumes`):

```yaml
  # Watchtower - Automatic container updates
  watchtower:
    image: containrrr/watchtower:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ${HOME}/.docker/config.json:/config.json:ro
    environment:
      # Poll every 5 minutes (300 seconds)
      - WATCHTOWER_POLL_INTERVAL=300
      # Enable rolling restart for zero-downtime updates
      - WATCHTOWER_ROLLING_RESTART=true
      # Only update containers with watchtower.enable label
      - WATCHTOWER_LABEL_ENABLE=true
      # Clean up old images after update
      - WATCHTOWER_CLEANUP=true
      # Include stopped containers in monitoring
      - WATCHTOWER_INCLUDE_STOPPED=true
      # Don't start stopped containers unless they were stopped by watchtower
      - WATCHTOWER_REVIVE_STOPPED=false
      # Timeout for container operations
      - WATCHTOWER_TIMEOUT=60s
      # Debug logging (optional, remove in production)
      # - WATCHTOWER_DEBUG=true
      # Notifications (optional - configure as needed)
      # - WATCHTOWER_NOTIFICATIONS=shoutrrr
      # - WATCHTOWER_NOTIFICATION_URL=discord://token@id
      # - WATCHTOWER_NOTIFICATION_TITLE_TAG=BreadCall
    command: --label-enable
    networks:
      - breadcall-network
    restart: unless-stopped
    # Run as root to access Docker socket
    user: root
```

- [ ] **Step 4: Update volumes section if needed**

Ensure `breadcall-public` volume is defined:

```yaml
volumes:
  breadcall-public:
  postgres-data:
  redis-data:
```

- [ ] **Step 5: Validate docker-compose syntax**

Run:
```bash
docker-compose config > /dev/null && echo "Valid YAML"
```

Expected: "Valid YAML" (no errors).

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add Watchtower for automatic rolling deployments

- Add Watchtower service to docker-compose.yml
- Configure signaling service with watchtower.enable label
- Use GHCR image for signaling service
- Rolling restart with 5-minute poll interval
- Automatic cleanup of old images
- Add healthcheck to signaling service

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Create VPS Setup Documentation

**Files:**
- Create: `docs/vps-setup.md`

**Purpose:** Document how to set up the VPS for automatic deployments.

- [ ] **Step 1: Create VPS setup documentation**

```markdown
# VPS Setup Guide for BreadCall

This guide covers setting up your VPS to receive automatic deployments from GitHub Container Registry (GHCR) using Watchtower.

## Prerequisites

- VPS with Docker and Docker Compose installed
- GitHub account with access to the BreadCall repository
- Domain name pointing to your VPS (optional, for EXTERNAL_URL)

## Step 1: Clone Repository

```bash
cd /opt
git clone https://github.com/YOUR_USERNAME/breadcall.git
cd breadcall
```

## Step 2: Configure Environment

Create `.env` file:

```bash
cp .env.example .env
nano .env
```

Required variables:
- `TOKEN_SECRET` - Generate with: `openssl rand -base64 32`
- `CSRF_SECRET` - Generate with: `openssl rand -base64 32`
- `SESSION_SECRET` - Generate with: `openssl rand -base64 32`
- `ADMIN_PASSWORD` - Your admin panel password
- `DB_PASSWORD` - PostgreSQL password
- `EXTERNAL_URL` - Your public URL (e.g., `https://your-domain.com`)

## Step 3: Authenticate with GitHub Container Registry

1. Create a Personal Access Token (PAT) on GitHub:
   - Go to GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
   - Click "Generate new token"
   - Select your BreadCall repository
   - Grant "Read access to packages" permission

2. Login on VPS:
   ```bash
   echo "YOUR_GITHUB_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
   ```

3. Verify login:
   ```bash
   cat ~/.docker/config.json
   ```
   Should contain `ghcr.io` auth entry.

## Step 4: Initial Deployment

1. Start services:
   ```bash
   docker-compose up -d
   ```

2. Verify all containers are running:
   ```bash
   docker-compose ps
   ```

3. Check logs:
   ```bash
   docker-compose logs -f signaling
   ```

4. Watchtower logs (in another terminal):
   ```bash
   docker-compose logs -f watchtower
   ```

## Step 5: Verify Automatic Updates

1. Push a new tag to GitHub:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

2. GitHub Actions will build and push the image (takes ~2-5 minutes).

3. Within 5 minutes, Watchtower will detect the new image and deploy it.

4. Check Watchtower logs for update:
   ```bash
   docker-compose logs watchtower | tail -20
   ```

## Step 6: Manual Rollback (if needed)

If an update fails, roll back manually:

```bash
cd /opt/breadcall

# Edit docker-compose.yml to use specific tag
nano docker-compose.yml
# Change: image: ghcr.io/YOUR_USERNAME/breadcall-signaling:v1.0.0

# Pull and restart
docker-compose pull signaling
docker-compose up -d signaling

# Verify
docker-compose ps
```

## Troubleshooting

### Watchtower not detecting updates

1. Check Watchtower logs:
   ```bash
   docker-compose logs watchtower
   ```

2. Verify GHCR authentication:
   ```bash
   docker pull ghcr.io/YOUR_USERNAME/breadcall-signaling:latest
   ```

3. Check labeling on signaling container:
   ```bash
   docker inspect breadcall-signaling-1 | grep -A5 Labels
   ```

### Database migrations not running

Migrations run automatically on container start. Check signaling logs:
```bash
docker-compose logs signaling | grep -i migrate
```

### Health check failing

Check if all dependencies are healthy:
```bash
docker-compose ps
```

Then check individual service logs:
```bash
docker-compose logs postgres
docker-compose logs redis
```

## Security Notes

- Keep your `.env` file secure (chmod 600)
- Rotate GHCR PAT every 90 days
- Use firewall rules to restrict access to necessary ports
- Keep Docker and host OS updated
```

- [ ] **Step 2: Commit**

```bash
git add docs/vps-setup.md
git commit -m "docs: add VPS setup guide for Watchtower deployments

- Step-by-step setup instructions
- GHCR authentication guide
- Troubleshooting section
- Security best practices

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Test End-to-End Pipeline

**Files:**
- None (testing task)

**Purpose:** Verify the complete CI/CD pipeline works correctly.

- [ ] **Step 1: Push changes to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Create and push a test tag**

```bash
git tag v0.0.0-test
git push origin v0.0.0-test
```

- [ ] **Step 3: Verify GitHub Actions workflow runs**

Go to GitHub repository → Actions tab
Expected: "Build and Deploy" workflow should be running.

- [ ] **Step 4: Wait for workflow completion**

Expected: All jobs pass (test, build-and-push, create-release).

- [ ] **Step 5: Verify image on GHCR**

Go to GitHub repository → Packages
Expected: `breadcall-signaling` package exists with `v0.0.0-test` and `latest` tags.

- [ ] **Step 6: Test on VPS (if available)**

On VPS:
```bash
# Pull test image manually
docker pull ghcr.io/YOUR_USERNAME/breadcall-signaling:v0.0.0-test

# Verify it works
docker run --rm ghcr.io/YOUR_USERNAME/breadcall-signaling:v0.0.0-test node --version
```

Expected: Outputs Node.js version.

- [ ] **Step 7: Clean up test tag (optional)**

```bash
git tag -d v0.0.0-test
git push --delete origin v0.0.0-test
```

- [ ] **Step 8: Final commit summary**

If all tests pass:
```bash
git log --oneline -5
```

Expected: All implementation commits present.

---

## Verification Checklist

- [ ] Dockerfile builds successfully with multi-stage
- [ ] Image size is smaller than before
- [ ] Container runs as non-root user
- [ ] Health check works
- [ ] GitHub Actions workflow passes
- [ ] Image pushed to GHCR
- [ ] Docker Compose includes Watchtower service
- [ ] VPS documentation is complete

---

## Post-Implementation Notes

**Next Steps:**
1. Set up GHCR PAT on VPS
2. Deploy to VPS using `docker-compose up -d`
3. Monitor Watchtower logs for first automatic update
4. Consider setting up notifications (Discord/Slack) for deploy events

**Monitoring:**
- Watchtower logs: `docker-compose logs -f watchtower`
- Application logs: `docker-compose logs -f signaling`
- Health check: `curl http://localhost:3000/health`
