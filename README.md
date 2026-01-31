# Docker Simple Secrets

A secure secrets management system with GPG encryption, HTMX interface, and optional OAuth2 authentication.

## Features

- 🔐 **GPG Symmetric Encryption** - Secrets encrypted with AES256
- 🚀 **Auto-deployment** - Secrets automatically deployed to tmpfs on first login
- 🔍 **Fuzzy Search** - Quickly find secrets across services
- 📦 **Bulk Import** - Import multiple secrets from .env files
- 🔄 **Incremental Deployment** - Only deploys changed secrets
- 🛡️ **Rate Limiting** - Protection against brute force attacks
- 🔑 **Optional OAuth2** - Single Sign-On support
- 💾 **Memory-only Password Storage** - Passwords never persisted to disk

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Production

```bash
npm run build
npm start
```

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

**Development:**

- Secrets: `./var/data/`
- Deployment: `./var/secrets/` (dev) or `/var/secrets/` (production)

**Production:**

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

### Creating Services

1. Click "New Service" and enter a service name
2. Service names can only contain: letters, numbers, hyphens, underscores

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
