# Quick OAuth2 Provider Reference

## ✨ OIDC Discovery Support

**Good news!** The application now supports automatic OpenID Connect (OIDC) discovery.

For providers that support OIDC (most modern providers), you only need:

```bash
OAUTH2_ENABLED=true
OAUTH2_CLIENT_ID=your-client-id
OAUTH2_CLIENT_SECRET=your-client-secret
OAUTH2_ISSUER_URL=https://your-provider.com
OAUTH2_PROVIDER_NAME=Your Provider
```

The authorization and token URLs will be discovered automatically from:

```
${OAUTH2_ISSUER_URL}/.well-known/openid-configuration
```

**Providers with OIDC discovery:** Google, Okta, Auth0, Keycloak, Azure AD, GitLab

**Providers without OIDC discovery:** GitHub (requires manual URLs)

---

## GitHub

```bash
OAUTH2_ENABLED=true
OAUTH2_CLIENT_ID=your-github-client-id
OAUTH2_CLIENT_SECRET=your-github-client-secret
OAUTH2_ISSUER_URL=https://github.com
OAUTH2_PROVIDER_NAME=GitHub
OAUTH2_AUTHORIZATION_URL=https://github.com/login/oauth/authorize
OAUTH2_TOKEN_URL=https://github.com/login/oauth/access_token
```

Callback: `http://localhost:3000/auth/oauth2/callback`

## GitLab

```bash
OAUTH2_ENABLED=true
OAUTH2_CLIENT_ID=your-gitlab-client-id
OAUTH2_CLIENT_SECRET=your-gitlab-client-secret
OAUTH2_ISSUER_URL=https://gitlab.com
OAUTH2_PROVIDER_NAME=GitLab
# ✓ GitLab supports OIDC discovery - no need to set URLs manually!
```

Callback: `http://localhost:3000/auth/oauth2/callback`

## Google

```bash
OAUTH2_ENABLED=true
OAUTH2_CLIENT_ID=your-client-id.apps.googleusercontent.com
OAUTH2_CLIENT_SECRET=your-client-secret
OAUTH2_ISSUER_URL=https://accounts.google.com
OAUTH2_PROVIDER_NAME=Google
# ✓ Google supports OIDC discovery - no need to set URLs manually!
```

Callback: `http://localhost:3000/auth/oauth2/callback`

## Okta

```bash
OAUTH2_ENABLED=true
OAUTH2_CLIENT_ID=your-okta-client-id
OAUTH2_CLIENT_SECRET=your-okta-client-secret
OAUTH2_ISSUER_URL=https://your-domain.okta.com
OAUTH2_PROVIDER_NAME=Okta
# ✓ Okta supports OIDC discovery - no need to set URLs manually!
```

Callback: `http://localhost:3000/auth/oauth2/callback`

## Auth0

```bash
OAUTH2_ENABLED=true
OAUTH2_CLIENT_ID=your-auth0-client-id
OAUTH2_CLIENT_SECRET=your-auth0-client-secret
OAUTH2_ISSUER_URL=https://your-domain.auth0.com
OAUTH2_PROVIDER_NAME=Auth0
# ✓ Auth0 supports OIDC discovery - no need to set URLs manually!
```

Callback: `http://localhost:3000/auth/oauth2/callback`

## Keycloak

```bash
OAUTH2_ENABLED=true
OAUTH2_CLIENT_ID=your-keycloak-client-id
OAUTH2_CLIENT_SECRET=your-keycloak-client-secret
OAUTH2_ISSUER_URL=https://your-domain.com/auth/realms/your-realm
OAUTH2_PROVIDER_NAME=Keycloak
# ✓ Keycloak supports OIDC discovery - no need to set URLs manually!
```

Callback: `http://localhost:3000/auth/oauth2/callback`

## Generic OAuth2 Provider

If your provider uses standard OAuth2 paths (`/oauth/authorize` and `/oauth/token`):

```bash
OAUTH2_ENABLED=true
OAUTH2_CLIENT_ID=your-client-id
OAUTH2_CLIENT_SECRET=your-client-secret
OAUTH2_ISSUER_URL=https://your-provider.com
OAUTH2_PROVIDER_NAME=Your Provider Name
# URLs will default to:
# ${OAUTH2_ISSUER_URL}/oauth/authorize
# ${OAUTH2_ISSUER_URL}/oauth/token
```

## Finding Your Provider's Endpoints

**Method 1: OIDC Discovery (Automatic)**
The application will automatically try this for you! Just set `OAUTH2_ISSUER_URL` and the rest is discovered.

**Method 2: Manual Discovery**

1. **Check documentation:** Look for "OAuth2 endpoints" or "Authorization server"
2. **OIDC Discovery URL:** Try `https://your-provider.com/.well-known/openid-configuration`
   - Open this URL in your browser to see all available endpoints
3. **Check logs:** The app logs the URLs it's using when it starts
4. **Network tab:** Use browser DevTools to see where the redirect goes

## Debugging

Start the server and check the console output:

```
OAuth2 Configuration:
  Authorization URL: https://github.com/login/oauth/authorize
  Token URL: https://github.com/login/oauth/access_token
  Callback URL: /auth/oauth2/callback
```

If you see a 404 error, the Authorization URL is incorrect for your provider.
