# CI/CD and Docker Optimization Design

**Date:** 2026-03-28
**Scope:** GitHub Actions CI/CD pipeline, multi-stage Docker build, rolling deployment to VPS

---

## 1. Overview

This design implements a complete CI/CD pipeline for BreadCall that:
- Builds Docker images in GitHub Actions (not on VPS)
- Pushes to GitHub Container Registry (GHCR)
- Performs zero-downtime rolling deployments to VPS using Watchtower (no SSH required)
- Uses multi-stage Docker builds for smaller, more secure images

---

## 2. Architecture

```
Developer pushes tag (v1.2.3)
         │
         ▼
┌─────────────────────┐
│   GitHub Actions    │
│  ┌───────────────┐  │
│  │  Run Tests    │  │
│  │  (Jest)       │  │
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ Build Docker  │  │
│  │ Image         │  │
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ Push to GHCR  │  │
│  │ (ghcr.io)     │  │
│  └───────────────┘  │
└─────────────────────┘
         │
         ▼ (Watchtower polls GHCR)
┌─────────────────────────────────────┐
│              VPS                    │
│  ┌─────────────┐  ┌─────────────┐  │
│  │  Watchtower │  │  signaling  │  │
│  │  (polls     │  │  (running)  │  │
│  │   GHCR)     │  │             │  │
│  └──────┬──────┘  └─────────────┘  │
│         │                           │
│         ▼ (new image detected)      │
│  ┌─────────────┐  ┌─────────────┐  │
│  │ Pull Image  │  │  signaling  │  │
│  │ from GHCR   │  │  (new)      │  │
│  └──────┬──────┘  │  starting   │  │
│         │         └─────────────┘  │
│         ▼                           │
│  ┌─────────────┐  ┌─────────────┐  │
│  │ Health Check│  │  signaling  │  │
│  │ (built-in)  │  │  (old)      │  │
│  └──────┬──────┘  │  stopping   │  │
│         │         └─────────────┘  │
│         ▼                           │
│  ┌─────────────┐                    │
│  │  Rollback   │  (if health fail) │
│  │  if needed  │                    │
│  └─────────────┘                    │
└─────────────────────────────────────┘
```

---

## 3. Components

### 3.1 GitHub Actions Workflow

**File:** `.github/workflows/deploy.yml`

**Triggers:**
- Tag push matching `v*.*.*` (e.g., `v1.2.3`)

**Jobs:**

#### Job 1: Test
- Checkout code
- Setup Node.js 20
- Install dependencies: `npm ci`
- Run tests: `npm test`
- Run build: `npm run build`

#### Job 2: Build & Push
- Depends on: Test (must pass)
- Login to GHCR using `GITHUB_TOKEN`
- Build multi-stage Docker image
- Push to `ghcr.io/{owner}/breadcall-signaling:{tag}`
- Also tag as `latest`

#### Job 3: Deploy (Optional - Manual Trigger)
- Depends on: Build & Push
- Optional: Create GitHub Release with changelog
- Note: Actual deployment handled by Watchtower on VPS

### 3.2 Multi-Stage Dockerfile

**Stages:**

#### Stage 1: Builder
- Base: `node:20-alpine`
- Install all dependencies (including dev)
- Copy source code
- Run `npm run build`
- Output: Built application in `/app/public` and `/app/server`

#### Stage 2: Production
- Base: `node:20-alpine`
- Install production dependencies only
- Copy built artifacts from builder
- Create non-root user (`node`)
- Set proper permissions
- Health check endpoint
- Expose port 3000
- Run as non-root user

**Benefits:**
- Smaller final image (~50-70% reduction)
- No build tools in production image
- Non-root user for security
- No source code in final image

### 3.3 Watchtower Configuration (VPS)

**What is Watchtower:**
Automated container updater that polls container registries for new images and performs rolling updates.

**Configuration:**

Add to `docker-compose.yml`:
```yaml
  watchtower:
    image: containrrr/watchtower:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /root/.docker/config.json:/config.json  # GHCR auth
    environment:
      - WATCHTOWER_POLL_INTERVAL=300  # Check every 5 minutes
      - WATCHTOWER_LABEL_ENABLE=true   # Only update labeled containers
      - WATCHTOWER_ROLLING_RESTART=true
      - WATCHTOWER_CLEANUP=true        # Remove old images
      - WATCHTOWER_INCLUDE_STOPPED=true
      - WATCHTOWER_REVIVE_STOPPED=false
      - WATCHTOWER_TIMEOUT=60s
      - WATCHTOWER_NOTIFICATIONS=shoutrrr
      - WATCHTOWER_NOTIFICATION_URL=discord://token@id  # Optional
    command: --label-enable
    restart: unless-stopped
```

**Label containers for Watchtower:**
Add to `signaling` service in docker-compose:
```yaml
  signaling:
    image: ghcr.io/{owner}/breadcall-signaling:latest
    labels:
      - "com.centurylinklabs.watchtower.enable=true"
```

**Authentication:**
1. Create GitHub PAT with `read:packages` scope
2. Login on VPS: `echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin`
3. Watchtower uses `/root/.docker/config.json` for auth

### 3.4 Database Migrations

**Approach:** Run migrations before service starts

**Implementation:**
- Add `npm run migrate:up` to Dockerfile CMD or entrypoint
- OR: Use docker-compose `command` override to run migrations first
- Migrations are idempotent (safe to run multiple times)

---

## 4. Security

### 4.1 GitHub Container Registry

**Authentication:**
- Use `GITHUB_TOKEN` (automatically provided by GitHub Actions)
- No manual token management needed
- Scoped to repository

**VPS Access to GHCR:**
- Create fine-grained PAT with `read:packages` scope
- Store on VPS as environment variable
- Rotate every 90 days

### 4.2 No SSH Required

**Advantage:** No inbound SSH access needed from GitHub Actions

**VPS Setup Only:**
- Initial setup done manually on VPS
- No deploy keys or SSH configuration needed
- Watchtower handles all updates automatically

### 4.3 Docker Security

**Non-root User:**
- Container runs as `node` user (UID 1000)
- No write access to system directories
- Read-only root filesystem where possible

**Secrets:**
- `.env` file stays on VPS, never committed
- Database credentials in `.env` only
- No secrets in Docker image layers

---

## 5. Rolling Update Strategy

### 5.1 Why Rolling Updates

Since VPS is behind remote nginx reverse proxy:
- No need for complex load balancing
- Docker handles container networking
- Simple start-new-then-stop-old approach

### 5.2 Process

```
Current State:
┌─────────────┐
│  signaling  │◄─── Traffic from nginx
│   (old)     │
└─────────────┘

Step 1: Start new container
┌─────────────┐  ┌─────────────┐
│  signaling  │  │  signaling  │◄─── New container
│   (old)     │  │   (new)     │     Health check pending
└─────────────┘  └─────────────┘

Step 2: Health check passes
┌─────────────┐  ┌─────────────┐
│  signaling  │  │  signaling  │◄─── Healthy, receiving traffic
│   (old)     │  │   (new)     │     (nginx round-robins)
└─────────────┘  └─────────────┘

Step 3: Stop old container
                 ┌─────────────┐
                 │  signaling  │◄─── Only container running
                 │   (new)     │
                 └─────────────┘
```

### 5.3 Health Check

**Endpoint:** `GET /health` (already implemented)

**Criteria:**
- HTTP 200 response
- Response time < 5 seconds
- Database connectivity confirmed
- Redis connectivity confirmed

**Timeout:**
- Start period: 10 seconds
- Interval: 5 seconds
- Timeout: 5 seconds
- Retries: 3

### 5.4 Rollback

**Trigger:**
- Health check fails after 60 seconds
- Container exits with non-zero code
- Manual intervention

**Process:**
1. Stop new container
2. Keep old container running (if still up)
3. Alert via GitHub Actions log
4. Manual investigation required

---

## 6. Environment Configuration

### 6.1 Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `GITHUB_TOKEN` | Auto-provided, for GHCR push |

### 6.2 Required VPS Configuration

**GitHub Container Registry Access:**
- Create fine-grained PAT with `read:packages` scope
- Store in VPS environment or `.env` file
- Run once: `echo $GHCR_PAT | docker login ghcr.io -u USERNAME --password-stdin`
- Watchtower uses Docker config for authentication

### 6.3 VPS Directory Structure

```
/opt/breadcall/
├── docker-compose.yml      # Includes watchtower service
├── .env                    # Environment variables
├── data/
│   ├── postgres/
│   └── redis/
└── logs/
```

**No deploy scripts needed** - Watchtower handles everything automatically.

---

## 7. Monitoring & Notifications

### 7.1 GitHub Actions Notifications

**Success:**
- Slack/Discord webhook notification (optional)
- GitHub release created automatically

**Failure:**
- GitHub Actions failure notification (email)
- Deploy script logs preserved on VPS

### 7.2 VPS Monitoring

**Health Checks:**
- Docker health check on signaling container
- Optional: Uptime Kuma or similar for external monitoring

**Logs:**
- Docker logs: `docker-compose logs -f signaling`
- Application logs: `/opt/breadcall/logs/`

---

## 8. Rollback Procedure

### 8.1 Watchtower Automatic Rollback

Watchtower performs rolling restart with health check:
1. Starts new container alongside old
2. Waits for health check (Docker HEALTHCHECK)
3. If healthy: stops old container
4. If unhealthy: stops new container, keeps old running

### 8.2 Manual Rollback

**If Watchtower rollback fails:**

```bash
# On VPS
cd /opt/breadcall

# Check which container is running
docker-compose ps

# Revert to specific tag
# Edit docker-compose.yml to use previous tag
vim docker-compose.yml

# Restart with old version
docker-compose up -d signaling

# Or: Pull and use specific version
docker pull ghcr.io/{owner}/breadcall-signaling:v1.2.2
docker-compose up -d signaling
```

---

## 9. Testing Strategy

### 9.1 CI Tests

**Unit Tests:**
- Run on every PR and tag push
- Must pass before build

**Integration Tests:**
- Optional: Run against test database
- Optional: E2E tests with Playwright

### 9.2 Deployment Verification

**Post-Deploy Checks:**
- Health endpoint responds
- WebSocket connections work
- Database migrations applied
- Static assets served correctly

---

## 10. Implementation Checklist

- [ ] Create `.github/workflows/deploy.yml`
- [ ] Optimize `Dockerfile` (multi-stage)
- [ ] Update `.dockerignore`
- [ ] Add Watchtower to `docker-compose.yml`
- [ ] Configure GHCR authentication on VPS
- [ ] Test deployment pipeline with `v0.0.0-test` tag
- [ ] Document rollback procedures
- [ ] Set up Watchtower notifications (optional)

---

## 11. Trade-offs Summary

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Build Location | GitHub Actions | Consistent environment, faster VPS deploys |
| Registry | GHCR | Free, integrated with GitHub, no extra auth |
| Update Strategy | Rolling (Watchtower) | Zero-downtime, no SSH required |
| Database Migrations | Auto-run on start | Simplest approach, idempotent |
| Secrets | VPS `.env` file | No secrets in images or repo |
| Deploy Method | Watchtower polling | No inbound SSH, fully automated |

---

## 12. Future Enhancements

- **Staging Environment:** Add second VPS or use Docker contexts
- **Blue-Green Deploy:** For instant rollback capability
- **Canary Deploys:** Route partial traffic to new version
- **Automated Rollback:** Based on error rate monitoring
- **Slack Notifications:** Real-time deploy status
- **Sentry Integration:** Track deploys with error monitoring
