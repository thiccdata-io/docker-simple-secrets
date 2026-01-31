# OAuth2 Testing Guide

## Quick Test with Mock OAuth2 Server

For local testing, you can use a mock OAuth2 server. Here's a simple setup:

### Option 1: Using OAuth2 Mock Server (ory/hydra)

```bash
# Install Docker if not already installed
# Run a local OAuth2 server for testing

docker run -d --name hydra-test \
  -p 4444:4444 \
  -p 4445:4445 \
  oryd/hydra:latest serve all --dangerous-force-http

# Create OAuth2 client
docker exec hydra-test \
  hydra clients create \
  --endpoint http://localhost:4445 \
  --id docker-secrets-client \
  --secret my-secret \
  --grant-types authorization_code,refresh_token \
  --response-types code \
  --scope openid,offline \
  --callbacks http://localhost:3000/auth/oauth2/callback
```

### Option 2: Using GitHub OAuth (Recommended)

1. Go to GitHub Settings → Developer settings → OAuth Apps
2. Click "New OAuth App"
3. Fill in:
   - Application name: `Docker Simple Secrets (Dev)`
   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL: `http://localhost:3000/auth/oauth2/callback`
4. Click "Register application"
5. Note your Client ID and generate a Client Secret

### Environment Configuration

Create a `.env` file:

```bash
NODE_ENV=development
PORT=3000

# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=your-generated-session-secret

# Enable OAuth2
OAUTH2_ENABLED=true

# GitHub OAuth Configuration
OAUTH2_CLIENT_ID=your-github-client-id
OAUTH2_CLIENT_SECRET=your-github-client-secret
OAUTH2_ISSUER_URL=https://github.com
OAUTH2_PROVIDER_NAME=GitHub

# GitHub-specific endpoints (required for GitHub)
OAUTH2_AUTHORIZATION_URL=https://github.com/login/oauth/authorize
OAUTH2_TOKEN_URL=https://github.com/login/oauth/access_token
```

### Testing the Flow

**Automatic Endpoint Discovery:**
The application automatically tries to discover OAuth2 endpoints using OpenID Connect (OIDC) discovery by fetching:

```
${OAUTH2_ISSUER_URL}/.well-known/openid-configuration
```

If discovery succeeds, you only need to set:

- `OAUTH2_ISSUER_URL`
- `OAUTH2_CLIENT_ID`
- `OAUTH2_CLIENT_SECRET`

The authorization and token URLs will be discovered automatically!

1. Start the application:

   ```bash
   npm run dev
   ```

2. Open browser to `http://localhost:3000`

3. You should see:
   - "Sign in with GitHub" button (if OAuth2 configured)
   - No password form initially

4. Click "Sign in with GitHub":
   - Redirects to GitHub authorization page
   - Authorize the application
   - Redirects back to your app

5. After OAuth2 authentication:
   - Status message shows "✓ You are authenticated via GitHub"
   - Password form appears below
   - Enter GPG password to access secrets

### Testing Password-Only Mode

To test without OAuth2:

```bash
# In .env
OAUTH2_ENABLED=false
```

Or simply don't set OAuth2 environment variables.

## Common OAuth2 Providers

### GitLab

```bash
OAUTH2_CLIENT_ID=your-gitlab-client-id
OAUTH2_CLIENT_SECRET=your-gitlab-client-secret
OAUTH2_ISSUER_URL=https://gitlab.com
OAUTH2_PROVIDER_NAME=GitLab

# GitLab uses standard OAuth2 paths (can be omitted if using defaults)
OAUTH2_AUTHORIZATION_URL=https://gitlab.com/oauth/authorize
OAUTH2_TOKEN_URL=https://gitlab.com/oauth/token
```

### Google

```bash
OAUTH2_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
OAUTH2_CLIENT_SECRET=your-google-client-secret
OAUTH2_ISSUER_URL=https://accounts.google.com
OAUTH2_PROVIDER_NAME=Google

# Google-specific endpoints
OAUTH2_AUTHORIZATION_URL=https://accounts.google.com/o/oauth2/v2/auth
OAUTH2_TOKEN_URL=https://oauth2.googleapis.com/token
```

### Okta

```bash
OAUTH2_CLIENT_ID=your-okta-client-id
OAUTH2_CLIENT_SECRET=your-okta-client-secret
OAUTH2_ISSUER_URL=https://your-domain.okta.com
OAUTH2_PROVIDER_NAME=Okta

# Okta endpoints
OAUTH2_AUTHORIZATION_URL=https://your-domain.okta.com/oauth2/v1/authorize
OAUTH2_TOKEN_URL=https://your-domain.okta.com/oauth2/v1/token
```

## Troubleshooting

### "404 Not Found" from OAuth2 provider

**First, check the server logs** when starting the application:

```
Attempting OIDC discovery from: https://your-provider.com/.well-known/openid-configuration
✓ OIDC discovery successful
OAuth2 Configuration:
  Provider: Your Provider
  Authorization URL: https://your-provider.com/oauth/authorize
  Token URL: https://your-provider.com/oauth/token
  Callback URL: /auth/oauth2/callback
```

**If OIDC discovery fails:**

The application will attempt discovery first. If it fails, you'll see:

```
OIDC discovery failed, using default OAuth2 paths
```

Then you need to manually set the endpoint URLs:

```bash
OAUTH2_AUTHORIZATION_URL=https://your-provider.com/path/to/authorize
OAUTH2_TOKEN_URL=https://your-provider.com/path/to/token
```

**Providers that support OIDC discovery:**

- Google
- Okta
- Auth0
- Keycloak
- Azure AD
- Most modern OAuth2/OIDC providers

**Providers that DON'T support OIDC discovery:**

- GitHub (requires manual URLs)
- GitLab (supports discovery)

Different providers use different endpoint paths. Check your provider's documentation and set the correct URLs:

```bash
# Example: Check server logs for the URLs being used
# The application logs: "Authorization URL: ..." and "Token URL: ..."

# Set provider-specific URLs:
OAUTH2_AUTHORIZATION_URL=https://your-provider.com/path/to/authorize
OAUTH2_TOKEN_URL=https://your-provider.com/path/to/token
```

**Common provider paths:**

- **GitHub:** `/login/oauth/authorize` and `/login/oauth/access_token`
- **GitLab:** `/oauth/authorize` and `/oauth/token` (default)
- **Google:** `/o/oauth2/v2/auth` and `/oauth2/googleapis.com/token`
- **Okta:** `/oauth2/v1/authorize` and `/oauth2/v1/token`

**How to find the correct URLs:**

1. Check your provider's OAuth2 documentation
2. Look for "Authorization endpoint" and "Token endpoint"
3. Some providers have OIDC discovery at `/.well-known/openid-configuration`

### "OAuth2 button not showing"

Check:

1. `OAUTH2_ENABLED=true` is set
2. All required env vars are set (CLIENT_ID, CLIENT_SECRET, ISSUER_URL)
3. Server was restarted after changing .env
4. Check server logs for configuration warnings

### "Callback URL mismatch"

Ensure the callback URL in your OAuth2 provider matches:

```
http://localhost:3000/auth/oauth2/callback  (dev)
https://your-domain.com/auth/oauth2/callback  (prod)
```

### "Session not persisting"

1. Check `SESSION_SECRET` is set
2. In production, ensure cookies are served over HTTPS
3. Check browser allows cookies

### "Still asks for password after OAuth2"

This is expected behavior:

- OAuth2 authenticates the **user**
- GPG password is needed to **decrypt secrets**
- Two-factor security: identity + secret access

## Security Notes

1. **Never commit `.env` to git** - it contains secrets
2. **Use strong SESSION_SECRET** - generate with crypto.randomBytes(32)
3. **Use HTTPS in production** - required for secure cookies
4. **Rotate OAuth2 secrets regularly** - especially if compromised
5. **Review OAuth2 scopes** - request minimum necessary permissions

## Production Deployment

1. Set environment variables (don't use .env file):

   ```bash
   export NODE_ENV=production
   export SESSION_SECRET=$(openssl rand -hex 32)
   export OAUTH2_ENABLED=true
   export OAUTH2_CLIENT_ID=prod-client-id
   export OAUTH2_CLIENT_SECRET=prod-client-secret
   export OAUTH2_ISSUER_URL=https://oauth-provider.com
   ```

2. Update OAuth2 callback URL to production domain

3. Enable HTTPS (required for secure cookies)

4. Build and start:
   ```bash
   npm run build
   npm start
   ```
