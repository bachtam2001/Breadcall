# CI/CD and Docker Optimization Design

**Date:** 2026-03-28
**Scope:** GitHub Actions CI/CD pipeline, multi-stage Docker build, rolling deployment to VPS

---

## 1. Overview

This design implements a complete CI/CD pipeline for BreadCall that:
- Builds Docker images in GitHub Actions (not on VPS)
- Pushes to GitHub Container Registry (GHCR)
- Performs zero-downtime rolling deployments to VPS
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
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ SSH Deploy    │  │
│  │ to VPS        │  │
│  └───────────────┘  │
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│        VPS          │
│  ┌───────────────┐  │
│  │ Pull Image    │  │
│  │ from GHCR     │  │
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ Rolling       │  │
│  │ Update        │  │
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ Health Check  │  │
│  └───────────────┘  │
└─────────────────────┘
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

#### Job 3: Deploy
- Depends on: Build & Push
- SSH to VPS using deploy key
- Run deploy script

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

### 3.3 Deploy Script (VPS)

**File:** `scripts/deploy.sh` (on VPS)

**Steps:**
1. Export GitHub token from environment
2. Login to GHCR: `echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin`
3. Pull new image: `docker pull ghcr.io/{owner}/breadcall-signaling:{tag}`
4. Update docker-compose.yml with new image tag
5. Rolling update:
   - Start new container: `docker-compose up -d --no-deps --scale signaling=2 signaling`
   - Wait for health check (30s timeout, 3 retries)
   - If healthy: remove old container
   - If unhealthy: rollback (remove new, keep old)
6. Cleanup: `docker image prune -f`

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

### 4.2 VPS SSH Access

**Authentication:**
- Deploy key (SSH key pair) stored in GitHub Secrets
- Restricted to deploy user on VPS (no sudo required)
- Key has no passphrase for automation

**Permissions:**
- Deploy user can:
  - Run docker commands
  - Write to `/opt/breadcall` directory
  - Restart services via docker-compose
- Deploy user cannot:
  - Access other system files
  - Execute arbitrary commands

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
| `VPS_HOST` | VPS IP address or hostname |
| `VPS_USER` | Deploy user username |
| `VPS_SSH_KEY` | Private key for SSH (deploy key) |
| `VPS_DEPLOY_PATH` | Path to docker-compose on VPS (e.g., `/opt/breadcall`) |
| `GHCR_PAT` | PAT for VPS to pull from GHCR |

### 6.2 Required VPS Setup

**Directory Structure:**
```
/opt/breadcall/
├── docker-compose.yml
├── .env
├── scripts/
│   └── deploy.sh
└── data/
    ├── postgres/
    └── redis/
```

**Docker Compose Override:**
- Use `docker-compose.prod.yml` for production-specific settings
- Or: Keep single `docker-compose.yml` and update image tag via env var

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

### 8.1 Automatic Rollback

Deploy script handles automatic rollback on health check failure.

### 8.2 Manual Rollback

**If automatic rollback fails:**

```bash
# On VPS
cd /opt/breadcall

# Revert to previous image
docker-compose pull ghcr.io/{owner}/breadcall-signaling:{previous-tag}
docker-compose up -d signaling

# Or: Use backup container if still running
docker-compose stop signaling-new
docker-compose start signaling-old
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
- [ ] Create `scripts/deploy.sh` for VPS
- [ ] Set up GitHub Secrets
- [ ] Configure VPS deploy user and SSH key
- [ ] Test deployment pipeline with `v0.0.0-test` tag
- [ ] Document rollback procedures
- [ ] Set up monitoring/notifications (optional)

---

## 11. Trade-offs Summary

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Build Location | GitHub Actions | Consistent environment, faster VPS deploys |
| Registry | GHCR | Free, integrated with GitHub, no extra auth |
| Update Strategy | Rolling | Simple, zero-downtime, works with remote nginx |
| Database Migrations | Auto-run on start | Simplest approach, idempotent |
| Secrets | VPS `.env` file | No secrets in images or repo |

---

## 12. Future Enhancements

- **Staging Environment:** Add second VPS or use Docker contexts
- **Blue-Green Deploy:** For instant rollback capability
- **Canary Deploys:** Route partial traffic to new version
- **Automated Rollback:** Based on error rate monitoring
- **Slack Notifications:** Real-time deploy status
- **Sentry Integration:** Track deploys with error monitoring
