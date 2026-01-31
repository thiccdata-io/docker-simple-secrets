import { Request, Response } from 'express';
import passport from 'passport';
import { Strategy as OAuth2Strategy } from 'passport-oauth2';
import fs from 'fs/promises';
import path from 'path';
import { RateLimitEntry } from './types';
import { MAX_ATTEMPTS, BLOCK_DURATION_MS, ATTEMPT_WINDOW_MS, DEPLOY_PATH, OAUTH2_ENABLED } from './config';

const rateLimitMap = new Map<string, RateLimitEntry>();

export function checkRateLimit(identifier: string): { allowed: boolean; message?: string } {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);

  if (!entry) {
    rateLimitMap.set(identifier, { attempts: 1, lastAttempt: now });
    return { allowed: true };
  }

  if (entry.blockedUntil && entry.blockedUntil > now) {
    const remainingMinutes = Math.ceil((entry.blockedUntil - now) / 60000);
    return { allowed: false, message: `Too many failed attempts. Try again in ${remainingMinutes} minutes.` };
  }

  if (now - entry.lastAttempt > ATTEMPT_WINDOW_MS) {
    entry.attempts = 1;
    entry.lastAttempt = now;
    delete entry.blockedUntil;
    return { allowed: true };
  }

  entry.attempts++;
  entry.lastAttempt = now;

  if (entry.attempts > MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_DURATION_MS;
    return { allowed: false, message: `Too many failed attempts. Blocked for ${BLOCK_DURATION_MS / 60000} minutes.` };
  }

  return { allowed: true };
}

export function resetRateLimit(identifier: string): void {
  rateLimitMap.delete(identifier);
}

export function isOAuth2Configured(): boolean {
  return OAUTH2_ENABLED && !!(process.env.OAUTH2_CLIENT_ID && process.env.OAUTH2_CLIENT_SECRET && process.env.OAUTH2_ISSUER_URL);
}

export async function loadSecretsFromFilesystem(serviceName: string): Promise<boolean> {
  try {
    const secretsDir = path.join(DEPLOY_PATH, serviceName);
    const entries = await fs.readdir(secretsDir);
    const secretFiles = entries.filter(file => file.endsWith('.txt'));

    if (secretFiles.length === 0) {
      return false;
    }

    console.log(`📦 Loading ${secretFiles.length} secrets for service: ${serviceName}`);

    for (const file of secretFiles) {
      const secretName = path.basename(file, '.txt').toUpperCase();
      const secretPath = path.join(secretsDir, file);
      const secretValue = await fs.readFile(secretPath, 'utf-8');
      process.env[secretName] = secretValue.trim();
      console.log(`   ✓ Loaded ${secretName}`);
    }

    return true;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return false;
    }
    console.error('Error loading secrets:', error);
    return false;
  }
}

export async function configureOAuth2(): Promise<boolean> {
  try {
    const clientId = process.env.OAUTH2_CLIENT_ID || '';
    const clientSecret = process.env.OAUTH2_CLIENT_SECRET || '';
    const issuerUrl = process.env.OAUTH2_ISSUER_URL || '';

    if (!clientId || !clientSecret || !issuerUrl) {
      return false;
    }

    const discoverEndpoints = async (): Promise<{ authorizationURL: string; tokenURL: string }> => {
      const authUrl = process.env.OAUTH2_AUTHORIZATION_URL || '';
      const tokenUrl = process.env.OAUTH2_TOKEN_URL || '';

      if (authUrl && tokenUrl) {
        return { authorizationURL: authUrl, tokenURL: tokenUrl };
      }

      try {
        console.log('Attempting OIDC discovery from:', `${issuerUrl}/.well-known/openid-configuration`);

        const discoveryUrl = `${issuerUrl}/.well-known/openid-configuration`;
        const response = await fetch(discoveryUrl);

        if (!response.ok) {
          throw new Error(`Discovery failed: ${response.status} ${response.statusText}`);
        }

        const metadata = (await response.json()) as Record<string, string>;
        console.log('✓ OIDC discovery successful');

        return { authorizationURL: metadata.authorization_endpoint, tokenURL: metadata.token_endpoint };
      } catch (discoveryError) {
        console.log('OIDC discovery failed, using default OAuth2 paths');
        return { authorizationURL: authUrl || `${issuerUrl}/oauth/authorize`, tokenURL: tokenUrl || `${issuerUrl}/oauth/token` };
      }
    };

    const { authorizationURL, tokenURL } = await discoverEndpoints();
    const scope = process.env.OAUTH2_SCOPE || 'openid';

    console.log('OAuth2 Configuration:');
    console.log('  Provider:', process.env.OAUTH2_PROVIDER_NAME || 'OAuth2 Provider');
    console.log('  Authorization URL:', authorizationURL);
    console.log('  Token URL:', tokenURL);
    console.log('  Scope:', scope);
    console.log('  Callback URL: /auth/oauth2/callback');

    passport.use(
      new OAuth2Strategy(
        {
          authorizationURL,
          tokenURL,
          clientID: clientId,
          clientSecret: clientSecret,
          callbackURL: '/auth/oauth2/callback',
          scope: scope.split(' '),
        },
        async (accessToken: string, refreshToken: string, profile: any, done: any) => {
          return done(null, { id: profile.id || 'oauth2-user', accessToken });
        },
      ),
    );

    passport.serializeUser((user: any, done) => {
      done(null, user);
    });

    passport.deserializeUser((user: any, done) => {
      done(null, user);
    });

    return true;
  } catch (error) {
    console.error('Failed to configure OAuth2:', error);
    console.error('OAuth2 authentication will not be available');
    return false;
  }
}

export function isAuthenticated(req: Request, res: Response, next: any) {
  if (isOAuth2Configured()) {
    if (req.isAuthenticated()) {
      return next();
    }
    return res.redirect('/auth/oauth2');
  }
  next();
}
