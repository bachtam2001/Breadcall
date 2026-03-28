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
   docker compose up -d
   ```

2. Verify all containers are running:
   ```bash
   docker compose ps
   ```

3. Check logs:
   ```bash
   docker compose logs -f signaling
   ```

4. Watchtower logs (in another terminal):
   ```bash
   docker compose logs -f watchtower
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
   docker compose logs watchtower | tail -20
   ```

## Step 6: Manual Rollback (if needed)

If an update fails, roll back manually:

```bash
cd /opt/breadcall

# Edit docker-compose.yml to use specific tag
nano docker-compose.yml
# Change: image: ghcr.io/YOUR_USERNAME/breadcall-signaling:v1.0.0

# Pull and restart
docker compose pull signaling
docker compose up -d signaling

# Verify
docker compose ps
```

## Troubleshooting

### Watchtower not detecting updates

1. Check Watchtower logs:
   ```bash
   docker compose logs watchtower
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
docker compose logs signaling | grep -i migrate
```

### Health check failing

Check if all dependencies are healthy:
```bash
docker compose ps
```

Then check individual service logs:
```bash
docker compose logs postgres
docker compose logs redis
```

## Security Notes

- Keep your `.env` file secure (chmod 600)
- Rotate GHCR PAT every 90 days
- Use firewall rules to restrict access to necessary ports
- Keep Docker and host OS updated
