# Docker Simple Secrets

A secure, web-based secrets management system designed specifically for Docker environments. Manage encrypted secrets through a clean web interface and automatically deploy them to your containers - no complex orchestration tools required.

## What Problem Does This Solve?

Docker Simple Secrets solves the universal challenge of **securely managing sensitive configuration** for containerized applications:

### 🔐 **Secrets Management**

- Store API keys, passwords, tokens, and credentials encrypted at rest
- Organize secrets by service (database, api, redis, etc.)
- Create, edit, delete, and search secrets through a web interface
- Bulk import from `.env` files
- Zero-trust: secrets encrypted with AES-256-GCM until deployment

### 📁 **Configuration File Management**

- Store entire configuration files as encrypted secrets
- Perfect for SSL certificates, JSON/YAML configs, SSH keys, or any file-based configuration
- Automatically inject files into running containers
- No manual copying or mounting required

### 🚀 **Automatic Deployment**

- Deploy secrets to running containers with a single click
- Secrets are automatically synced to labeled containers via Docker API
- Incremental deployments - only changed secrets are updated (MD5 tracking)
- tmpfs storage ensures secrets never touch disk

## Getting Started

### ⚠️ Important: Run in Docker Only

Docker Simple Secrets is designed to run **inside Docker** to access the Docker socket and inject secrets into other containers. Running it outside Docker (bare metal/VM) is **not recommended** and will limit functionality.

### Quick Start with Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  # Docker Simple Secrets - Web UI for managing secrets
  docker-simple-secrets:
    image: yourusername/docker-simple-secrets:latest
    container_name: docker-simple-secrets
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
      - DSS_SERVICE_NAME=docker-simple-secrets
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock # Required: Docker API access
      - ./data:/var/data # Persistent: encrypted secrets
      - secrets-tmpfs:/var/shared-secrets # Shared: wrapper script + mounted secrets (tmpfs)
    restart: unless-stopped

  # Example: PostgreSQL using secrets via entrypoint wrapper (RECOMMENDED)
  postgres:
    image: postgres:16-alpine
    container_name: postgres
    labels:
      - 'dss.postgres.mount=/run/secrets' # Links service to secrets
    environment:
      - DSS_SERVICE_NAME=postgres
    volumes:
      - secrets-tmpfs:/var/shared-secrets:ro # Mount wrapper + secrets
    entrypoint: ['/bin/sh', '/var/shared-secrets/dss-entrypoint-wrapper.sh']
    command: ['docker-entrypoint.sh', 'postgres']
    restart: unless-stopped

volumes:
  secrets-tmpfs:
    driver: local
    driver_opts:
      type: tmpfs # Memory-only storage
      device: tmpfs
      o: uid=1001,gid=1001,mode=700
```

Start the stack:

```bash
docker compose up -d
```

Access the web interface at **http://localhost:3000**

## Two Methods to Use Secrets

### Method 1: Entrypoint Wrapper + Labels (⭐ RECOMMENDED)

The preferred method. Use the provided `dss-entrypoint-wrapper.sh` script (automatically deployed to the shared tmpfs volume) combined with Docker labels to load secrets as environment variables.

**How it works:**

1. Add a `dss.<service-name>.mount` label to your container
2. Mount the `secrets-tmpfs` volume (read-only)
3. Set your container's entrypoint to use `/var/shared-secrets/dss-entrypoint-wrapper.sh`
4. **Mark secrets as "mounted"** (click 🔒 to unlock 🔓 in the UI)
5. Deploy secrets - the wrapper automatically exports them as environment variables
6. Your original command executes with secrets available

**Example:**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    labels:
      - 'dss.postgres.mount=/run/secrets' # Links service to secrets
    environment:
      - DSS_SERVICE_NAME=postgres
    volumes:
      - secrets-tmpfs:/var/shared-secrets:ro
    entrypoint: ['/bin/sh', '/var/shared-secrets/dss-entrypoint-wrapper.sh']
    command: ['docker-entrypoint.sh', 'postgres'] # Your original command
    # Wrapper loads secrets from /var/shared-secrets/postgres/ as env vars:
    # POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB

  redis:
    image: redis:alpine
    labels:
      - 'dss.redis.mount=/run/secrets'
    environment:
      - DSS_SERVICE_NAME=redis
    volumes:
      - secrets-tmpfs:/var/shared-secrets:ro
    entrypoint: ['/bin/sh', '/var/shared-secrets/dss-entrypoint-wrapper.sh']
    command: ['redis-server', '--requirepass', '${REDIS_PASSWORD}']
```

**Note:** Only secrets with the "mounted" state (🔓) will be available in `/var/shared-secrets` for the wrapper to load.

**Advantages:**

- ✅ Automatic environment variable injection
- ✅ Works with most container images
- ✅ No code changes required in your application
- ✅ Wrapper script provided in shared volume
- ✅ Clean integration with Docker labels

### Method 2: Direct File Reading (⚠️ When Wrapper Won't Work)

For cases where the entrypoint wrapper doesn't work (complex entrypoint chains, specific initialization requirements), mount the shared tmpfs volume and read secrets as files directly in your application code.

**How it works:**

1. Mount the `secrets-tmpfs` volume to your container
2. Create secrets in the web UI under your service name
3. **Mark secrets as "mounted"** (click the 🔒 icon to unlock 🔓 in the UI)
4. Deploy secrets - they appear at `/var/shared-secrets/<service-name>/`
5. Your application reads files directly from the mounted path

**Note:** Only secrets with the "mounted" state (🔓) will be deployed to `/var/shared-secrets`.

**Example:**

```yaml
services:
  nginx:
    image: nginx:alpine
    volumes:
      - secrets-tmpfs:/var/shared-secrets:ro # Mount as read-only
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    # Access secrets at:
    # /var/shared-secrets/nginx/ssl_cert.pem
    # /var/shared-secrets/nginx/ssl_key.pem

  api:
    image: node:20-alpine
    volumes:
      - secrets-tmpfs:/var/shared-secrets:ro
      - ./app:/app
    working_dir: /app
    command: node server.js
    # In server.js:
    # const apiKey = fs.readFileSync('/var/shared-secrets/api/API_KEY', 'utf8');
```

**When to use this method:**

- Configuration files (SSL certificates, JSON/YAML configs, SSH keys)
- Complex entrypoint scenarios where wrapper conflicts occur
- Applications that prefer file-based secret loading
- When you need full control over secret loading logic

**Advantages:**

- ✅ Full control over how secrets are loaded
- ✅ Works with any programming language
- ✅ Perfect for configuration files
- ✅ Read-only mount prevents accidental modification
- ✅ No entrypoint modification required

## Configuration

### Environment Variables

```bash
# Basic Configuration
NODE_ENV=production
PORT=3000
SESSION_SECRET=generate-a-secure-random-string

# Service Name (for self-hosting secrets)
DSS_SERVICE_NAME=docker-simple-secrets

# OAuth2 Configuration (Optional)
OAUTH2_ENABLED=true
OAUTH2_CLIENT_ID=your-client-id
OAUTH2_CLIENT_SECRET=your-client-secret
OAUTH2_ISSUER_URL=https://your-oauth-provider.com
OAUTH2_PROVIDER_NAME=GitHub
OAUTH2_SCOPE=openid profile email

# OAuth2 Endpoint URLs (Optional - if your provider uses non-standard paths)
OAUTH2_AUTHORIZATION_URL=https://github.com/login/oauth/authorize
OAUTH2_TOKEN_URL=https://github.com/login/oauth/access_token
```

See [OAUTH2_SETUP.md](OAUTH2_SETUP.md) for provider-specific OAuth2 configuration.

### Directory Structure

- **Encrypted secrets:** `/var/data/` (persistent, never exposed to containers)
- **Shared secrets:** `/var/shared-secrets/` (tmpfs, memory-only, contains `dss-entrypoint-wrapper.sh` and deployed "mounted" secrets)
- **Container-level secrets:** `/var/secrets/` (internal use only)

## Security

### Encryption

- **AES-256-GCM** - Authenticated encryption with Galois/Counter Mode
- **Native Node.js crypto** - No external dependencies, pure JavaScript implementation
- **scrypt key derivation** - 16384 iterations for password-based key generation
- **Random salt & IV** - Each secret gets unique cryptographic parameters
- **Authenticated encryption** - Integrity verification prevents tampering
- **File format:** `.aes` extension with embedded metadata

### Storage Security

- **tmpfs deployment** - Decrypted secrets stored in memory-only volumes (never touch disk)
- **Encrypted at rest** - All secrets stored with AES-256-GCM encryption
- **Incremental deployment** - MD5 tracking ensures only changed secrets are redeployed
- **Automatic cleanup** - Old/deleted secrets removed from deployment

### Authentication & Authorization

- **Rate limiting** - Maximum 5 password attempts per 5-minute window, 15-minute block after exceeding
- **Memory-only password storage** - Master password kept in browser memory only, cleared on tab close
- **Optional OAuth2** - Add SSO with GitHub, GitLab, Google, Okta, or any OIDC provider
- **Session security** - HTTP-only cookies, secure cookies in production, 24-hour expiration

## OAuth2 Setup (Optional)

When `OAUTH2_ENABLED=true`, the following environment variables are required:

- `OAUTH2_CLIENT_ID` - Your OAuth2 application client ID
- `OAUTH2_CLIENT_SECRET` - Your OAuth2 application client secret
- `OAUTH2_ISSUER_URL` - The base URL of your OAuth2 provider
- `OAUTH2_PROVIDER_NAME` - (Optional) Display name for the provider

**OIDC Discovery:** The application automatically discovers OAuth2 endpoints from `${OAUTH2_ISSUER_URL}/.well-known/openid-configuration`.

**Callback URL:** Configure your OAuth2 application with:

```
http://your-domain.com/auth/oauth2/callback
```

**Supported Providers:** GitHub, GitLab, Google, Okta, Auth0, Keycloak, or any OIDC-compliant provider.

See [OAUTH2_SETUP.md](OAUTH2_SETUP.md) for detailed provider-specific configurations.

## Usage Examples

### Example 1: Complete Web Stack

```yaml
services:
  docker-simple-secrets:
    image: yourusername/docker-simple-secrets:latest
    ports:
      - '3000:3000'
    environment:
      - DSS_SERVICE_NAME=docker-simple-secrets
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/var/data
      - secrets-tmpfs:/var/shared-secrets

  postgres:
    image: postgres:16-alpine
    labels:
      - 'dss.postgres.mount=/run/secrets' # Links to postgres secrets
    environment:
      - DSS_SERVICE_NAME=postgres
    volumes:
      - secrets-tmpfs:/var/shared-secrets:ro
    entrypoint: ['/bin/sh', '/var/shared-secrets/dss-entrypoint-wrapper.sh']
    command: ['docker-entrypoint.sh', 'postgres']
    # Wrapper exports: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB

  redis:
    image: redis:alpine
    labels:
      - 'dss.redis.mount=/run/secrets'
    environment:
      - DSS_SERVICE_NAME=redis
    volumes:
      - secrets-tmpfs:/var/shared-secrets:ro
    entrypoint: ['/bin/sh', '/var/shared-secrets/dss-entrypoint-wrapper.sh']
    command: ['redis-server', '--requirepass', '${REDIS_PASSWORD}']

  api:
    image: node:20-alpine
    volumes:
      - secrets-tmpfs:/var/shared-secrets:ro
      - ./app:/app
    working_dir: /app
    command: node server.js
    # In server.js: const apiKey = fs.readFileSync('/var/shared-secrets/api/API_KEY', 'utf8');

volumes:
  secrets-tmpfs:
    driver: local
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: uid=1001,gid=1001,mode=700
```

### Example 2: Nginx with SSL Certificates (Direct File Reading)

```yaml
services:
  docker-simple-secrets:
    image: yourusername/docker-simple-secrets:latest
    ports:
      - '3000:3000'
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/var/data
      - secrets-tmpfs:/var/shared-secrets

  nginx:
    image: nginx:alpine
    ports:
      - '443:443'
    volumes:
      - secrets-tmpfs:/var/shared-secrets:ro
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    # In nginx.conf:
    # ssl_certificate /var/shared-secrets/nginx/cert.pem;
    # ssl_certificate_key /var/shared-secrets/nginx/key.pem;

volumes:
  secrets-tmpfs:
    driver: local
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: uid=1001,gid=1001,mode=700
```

## Web Interface

1. **First-time setup:** Set a master password (stored in browser memory only)
2. **Create services:** Click "New Service" and name it (e.g., "postgres", "api")
3. **Add secrets:** Click "New Secret" under a service, enter name and value
4. **Bulk import:** Paste `.env` file content to import multiple secrets
5. **Deploy:** Click "🚀 Deploy" - secrets are encrypted, deployed to tmpfs, and injected into labeled containers
6. **Search:** Use fuzzy search to find secrets across all services

### Deployment Status Indicators

- ✓ **Deployed** - Secret is deployed and up-to-date
- 🔄 **Changed** - Secret exists but has been modified since last deployment
- ⚠️ **Undeployed** - Secret created but not yet deployed

## Development

For local development outside Docker, see [DEVELOPMENT.md](DEVELOPMENT.md).

**Note:** Some features (like automatic injection via labels) require Docker socket access and won't work in development mode.

## Architecture

- **Backend:** Express + TypeScript
- **Frontend:** HTMX + EJS templates
- **Encryption:** Native Node.js crypto (AES-256-GCM)
- **Authentication:** Passport.js (OAuth2) + custom password validation
- **Session:** express-session with memory store
- **Docker Integration:** HTTP API via Unix socket

## Code Style

See [CODE_STYLE.md](CODE_STYLE.md) for project coding standards.

## License

MIT

See [CODE_STYLE.md](CODE_STYLE.md) for project coding standards.

## License

MIT
