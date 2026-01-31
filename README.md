# Docker Simple Secrets

A secure, web-based secrets management system designed for Docker environments. Manage encrypted secrets with GPG, deploy them to containers via environment variables or configuration files, and access everything through a simple HTMX interface with optional OAuth2 authentication.

## What Does It Do?

Docker Simple Secrets solves the challenge of securely managing sensitive configuration for Docker containers. It provides:

### 🔐 Secure Secret Storage

- Store secrets encrypted with GPG AES256 symmetric encryption
- Web interface for creating, editing, and organizing secrets by service
- Bulk import from `.env` files
- Fuzzy search across all secrets

### 🚀 Two Deployment Modes

**1. Environment Variables (Recommended)**

- Secrets are decrypted and injected as environment variables into your containers
- Use the included entrypoint script to automatically load secrets at container startup
- Perfect for: database passwords, API keys, OAuth credentials, and any 12-factor app configuration

**2. Configuration Files**

- Store entire configuration files as encrypted secrets
- Access decrypted files in a shared tmpfs volume
- Perfect for: SSL certificates, JSON/YAML config files, SSH keys, or any file-based configuration

### 🛡️ Security First

- **GPG encryption** - Military-grade AES256 encryption for all secrets
- **tmpfs deployment** - Decrypted secrets stored in memory-only volumes (never touch disk)
- **Rate limiting** - Protection against brute force password attacks
- **Memory-only password storage** - Master password never persisted to disk
- **Optional OAuth2** - Add SSO with GitHub, GitLab, Google, Okta, or any OIDC provider

### 📦 Smart Deployment

- **Incremental updates** - Only redeploys changed secrets (MD5 tracking)
- **Auto-deployment** - Secrets automatically deployed on first login
- **Real-time status** - Visual indicators for deployed/changed/undeployed secrets

## Features

- 🔐 **GPG Symmetric Encryption** - Secrets encrypted with AES256
- 🚀 **Auto-deployment** - Secrets automatically deployed to tmpfs on first login
- 🔍 **Fuzzy Search** - Quickly find secrets across services
- 📦 **Bulk Import** - Import multiple secrets from .env files
- 🔄 **Incremental Deployment** - Only deploys changed secrets
- 🛡️ **Rate Limiting** - Protection against brute force attacks
- 🔑 **Optional OAuth2** - Single Sign-On support
- 💾 **Memory-only Password Storage** - Passwords never persisted to disk
- 🐳 **Container-Ready** - Drop-in entrypoint script for any Docker image

## Getting Started

### Production Deployment (Docker)

Docker Simple Secrets is designed to run in Docker. Use the provided `Dockerfile` and `docker-compose.yml`:

```yaml
services:
  docker-simple-secrets:
    build: .
    # Or use pre-built image:
    # image: yourusername/docker-simple-secrets:latest
    container_name: docker-simple-secrets
    ports:
      - '3000:3000'
    environment:
      - OAUTH2_ENABLED=true # Optional
      - DSS_SERVICE_NAME=docker-simple-secrets
    volumes:
      - ./var/data:/var/data # Persistent encrypted secrets
      - secrets-volume:/var/secrets # Temporary decrypted secrets (tmpfs)
    restart: unless-stopped

volumes:
  secrets-volume:
    driver: local
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: uid=1001,gid=1001,mode=700
```

Then run:

```bash
docker compose up -d
```

Access the web interface at http://localhost:3000

### Development

For local development, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Basic Configuration
NODE_ENV=production
PORT=3000
SESSION_SECRET=generate-a-secure-random-string

# OAuth2 Configuration (Optional)
OAUTH2_ENABLED=true
OAUTH2_CLIENT_ID=your-client-id
OAUTH2_CLIENT_SECRET=your-client-secret
OAUTH2_ISSUER_URL=https://your-oauth-provider.com
OAUTH2_PROVIDER_NAME=GitHub  # Optional, defaults to "OAuth2 Provider"
OAUTH2_SCOPE=openid profile email  # Optional, defaults to "openid"

# OAuth2 Endpoint URLs (Optional - if your provider uses non-standard paths)
OAUTH2_AUTHORIZATION_URL=https://github.com/login/oauth/authorize
OAUTH2_TOKEN_URL=https://github.com/login/oauth/access_token
```

### Directory Structure

- Secrets: `/var/data/`
- Deployment: `/secrets/`

## OAuth2 Setup

### Requirements

When `OAUTH2_ENABLED=true`, the following environment variables are required:

- `OAUTH2_CLIENT_ID` - Your OAuth2 application client ID
- `OAUTH2_CLIENT_SECRET` - Your OAuth2 application client secret
- `OAUTH2_ISSUER_URL` - The base URL of your OAuth2 provider
- `OAUTH2_PROVIDER_NAME` - (Optional) Display name for the provider
- `OAUTH2_SCOPE` - (Optional) Space-separated scopes, defaults to "openid"
- `OAUTH2_AUTHORIZATION_URL` - (Optional) Full authorization endpoint URL
- `OAUTH2_TOKEN_URL` - (Optional) Full token endpoint URL

**OIDC Discovery:** The application automatically attempts to discover OAuth2 endpoints from `${OAUTH2_ISSUER_URL}/.well-known/openid-configuration`. If discovery fails or you need to override, set the explicit URLs.

**Note:** If you get 404 errors, check the server logs to see which URLs are being used. See [OAUTH2_SETUP.md](OAUTH2_SETUP.md) for provider-specific configurations.

### Callback URL

Configure your OAuth2 application with the callback URL:

```
http://your-domain.com/auth/oauth2/callback
```

### Supported Providers

The OAuth2 implementation follows the standard OAuth2 protocol and should work with:

- GitHub
- GitLab
- Google
- Okta
- Auth0
- Keycloak
- Any OAuth2-compliant provider

### OAuth2 Flow

1. User clicks "Sign in with [Provider]" button
2. User is redirected to OAuth2 provider for authentication
3. After successful authentication, user is redirected back
4. User still needs to enter GPG password to decrypt secrets

**Note:** OAuth2 authenticates the _user_, but the GPG password is still required to decrypt secrets. This provides two-factor security: OAuth2 for user identity and GPG password for secret access.

## Password-Only Mode

If `OAUTH2_ENABLED=false` or OAuth2 is not configured, the application uses password-only authentication:

- Password validates against `.password-validation.gpg`
- First-time setup creates the validation file
- Rate limiting protects against brute force attacks
- Password stored in memory only (cleared on tab close)

## Security Features

### GPG Encryption

- Symmetric encryption with AES256 cipher
- Passphrase files with mode 0o600 (read/write owner only)
- Automatic cleanup of temporary passphrase files
- Validation file hidden from UI (`.password-validation.gpg`)

### Rate Limiting

- Maximum 5 attempts per 5-minute window
- 15-minute block after exceeding limit
- Per-IP tracking

### Session Security

- HTTP-only cookies
- Secure cookies in production
- 24-hour session expiration
- CSRF protection via session secret

## Usage

### Quick Start with Docker Compose

````yaml
services:
  # Docker Simple Secrets - Web UI for managing secrets
  docker-simple-secrets:
    image: yourusername/docker-simple-secrets:latest
    ports:
      - '3000:3000'
    environment:
      - OAUTH2_ENABLED=true  # Optional
      - DSS_SERVICE_NAME=docker-simple-secrets
    volumes:
      - ./var/data:/var/data          # Encrypted secrets storage
      - secrets-volume:/var/secrets   # Decrypted secrets (tmpfs)

  # Example: Any container can load secrets as environment variables
  postgres:
    image: postgres:16-alpine
    environment:
      - DSS_SERVICE_NAME=postgres
      - DSS_SERVICE_CMD=docker-entrypoint.sh postgres
    volumes:
      - secret🚀 Deploy" button in the web UI
2. Secrets are decrypted and deployed to the tmpfs volume at `/var/secrets/<service-name>/`
3. Deployment status shown: ✓ deployed, 🔄 changed, ⚠️ undeployed
4. Only changed secrets are redeployed (incremental, using MD5 hashing)
5. The entrypoint script is automatically copied to `/var/secrets/entrypoint.sh`

### How the Entrypoint Works

The entrypoint script (`/var/secrets/entrypoint.sh`) loads secrets as environment variables:

1. Reads all files in `/var/secrets/$DSS_SERVICE_NAME/`
2. Exports each filename as an environment variable with its contents as the value
3. Executes your container's original command with secrets loaded

**Example:**
```bash
# If you have these files:
/var/secrets/postgres/POSTGRES_USER
/var/secrets/postgres/POSTGRES_PASSWORD

# The script exports:
export POSTGRES_USER="<contents of POSTGRES_USER file>"
export POSTGRES_PASSWORD="<contents of POSTGRES_PASSWORD file>"

# Then runs your command:
exec docker-entrypoint.sh postgres
````

### Real-World Examples

**PostgreSQL with secrets:**

```yaml
postgres:
  image: postgres:16-alpine
  environment:
    - DSS_SERVICE_NAME=postgres
    - DSS_SERVICE_CMD=docker-entrypoint.sh postgres
  volumes:
    - secrets-volume:/var/secrets:ro
  entrypoint: ['/bin/sh', '/var/secrets/entrypoint.sh', 'postgres']
```

**Node.js app with API keys:**

```yaml
api:
  image: node:20-alpine
  environment:
    - DSS_SERVICE_NAME=api
  volumes:
    - secrets-volume:/var/secrets:ro
    - ./app:/app
  working_dir: /app
  entrypoint: ['/bin/sh', '/var/secrets/entrypoint.sh', 'api']
  command: ['node', 'server.js']
```

**Nginx with SSL certificates (file-based):**

```yaml
nginx:
  image: nginx:alpine
  volumes:
    - secrets-volume:/var/secrets:ro
  # Access certificate files directly:
  # /var/secrets/nginx/ssl_cert.pem
  # /var/secrets/nginx/ssl_key.pem
```

secrets-volume:
driver: local
driver_opts:
type: tmpfs # Memory-only, never touches disk
device: tmpfs
o: uid=1001,gid=1001,mode=700

```

### Using Secrets as Environment Variables

The entrypoint script automatically loads all secrets for your service as environment variables:

**Step 1:** Create secrets in the web UI (http://localhost:3000):
```

Service: postgres
Secrets:

- POSTGRES_USER: myuser
- POSTGRES_PASSWORD: supersecret
- POSTGRES_DB: myapp

````

**Step 2:** Deploy secrets (click "🚀 Deploy" button)

**Step 3:** Secrets are automatically available as environment variables in your container:
```bash
# Inside the postgres container:
echo $POSTGRES_USER      # myuser
echo $POSTGRES_PASSWORD  # supersecret
echo $POSTGRES_DB        # myapp
````

### Using Secrets as Configuration Files

You can also store entire configuration files as secrets:

**Step 1:** Create a secret with file contents:

```
Service: nginx
Secret name: nginx.conf
Secret value:
server {
    listen 80;
    server_name example.com;
    ssl_certificate /var/secrets/nginx/ssl_cert.pem;
    ...
}
```

**Step 2:** Deploy and mount the secrets volume

**Step 3:** Access files in your container:

```bash
# Inside the nginx container:
cat /var/secrets/nginx/nginx.conf
cat /var/secrets/nginx/ssl_cert.pem
```

### Environment Variables

**For Docker Simple Secrets container:**

- `DSS_SERVICE_NAME` - Service name for this instance (e.g., "docker-simple-secrets")
- `OAUTH2_ENABLED` - Enable OAuth2 authentication (true/false)
- `DATA_DIR` - Where encrypted secrets are stored (default: /var/data)
- `SECRETS_DIR` - Where decrypted secrets are deployed (default: /var/secrets)

**For containers loading secrets:**

- `DSS_SERVICE_NAME` - Service name matching secrets in the web UI (e.g., "postgres", "redis")
- `DSS_SERVICE_CMD` - Original command to run after loading secrets (optional)

### Creating Services

1. Click "New Service" and enter a service name
2. Service names can only contain: letters, numbers, hyphens, underscores
3. Service name should match the `DSS_SERVICE_NAME` in your docker-compose.yml

### Adding Secrets

1. Click "New Secret" under a service
2. Enter secret name and value
3. Secret is encrypted and stored

### Bulk Import

1. Click "Bulk Import" under a service
2. Paste .env file content:
   ```
   DATABASE_URL=postgresql://localhost/db
   API_KEY=sk-1234567890
   ```
3. All valid KEY=VALUE pairs are imported

### Deployment

1. Click the "Deploy All" button
2. Secrets are decrypted and deployed to `/secrets/`
3. Deployment status shown: ✓ deployed, 🔄 changed, ⚠️ undeployed
4. Only changed secrets are redeployed (incremental)

### Search

Use the search box to filter secrets across all services with fuzzy matching.

## Architecture

- **Backend:** Express + TypeScript
- **Frontend:** HTMX + EJS templates
- **Encryption:** GPG (via shell commands)
- **Authentication:** Passport.js (OAuth2) + custom password validation
- **Session:** express-session

## Code Style

See [CODE_STYLE.md](CODE_STYLE.md) for project coding standards.

## License

MIT
