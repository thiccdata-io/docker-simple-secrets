import path from 'path';

export const PORT = process.env.PORT || 3000;

// Use /var in production, ./var in development
const BASE_DIR = process.env.NODE_ENV !== 'development' ? '/var' : path.join(__dirname, '../..', 'var');
export const DATA_DIR = path.join(BASE_DIR, 'data');
export const SECRETS_STORE_PATH = DATA_DIR;
export const PASSWORD_VALIDATION_FILE = path.join(DATA_DIR, '.password-validation.aes');
// Container-level secrets (for Docker Archive API injection)
export const CONTAINER_SECRETS_PATH =
  process.env.NODE_ENV !== 'development' ? '/var/secrets' : path.join(__dirname, '../..', 'var', 'secrets');
// Shared secrets mount (tmpfs, only for mounted=true secrets)
export const DEPLOY_PATH =
  process.env.NODE_ENV !== 'development' ? '/var/shared-secrets' : path.join(__dirname, '../..', 'var', 'shared-secrets');

// OAuth2 Configuration
export const OAUTH2_ENABLED = process.env.OAUTH2_ENABLED === 'true';

// Rate limiting constants
export const MAX_ATTEMPTS = 5;
export const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
export const ATTEMPT_WINDOW_MS = 5 * 60 * 1000; // 5 minute window

export const SESSION_SECRET = process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex');
