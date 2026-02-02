import express from 'express';
import path from 'path';
import session from 'express-session';
import passport from 'passport';
import fs from 'fs/promises';
import { execSync } from 'child_process';
import { PORT, SESSION_SECRET, DEPLOY_PATH, CONTAINER_SECRETS_PATH } from './utils/config';
import { isOAuth2Configured, configureOAuth2 } from './utils/auth';
// import { startContainerWatcher, stopContainerWatcher } from './utils/container-watcher';

// Import routers
import healthRouter from './routes/health';
import oauthRouter from './routes/oauth';
import viewsRouter from './routes/views';
import passwordRouter from './routes/password';
import servicesRouter from './routes/services';
import secretsRouter from './routes/secrets';
import deployRouter from './routes/deploy';
import apiServicesRouter from './api/services';

const app = express();

// Startup check: Ensure /var/shared-secrets is mounted as tmpfs
async function checkSecretsMount(): Promise<void> {
  try {
    // Check if DEPLOY_PATH exists
    await fs.access(DEPLOY_PATH);

    // Read /proc/mounts to check filesystem type (Linux only)
    let mounts: string;
    try {
      mounts = execSync('cat /proc/mounts', { encoding: 'utf8' });
    } catch {
      // /proc/mounts doesn't exist (not Linux) - skip mount check
      console.warn('⚠️  Warning: Mount check skipped (not running on Linux)');
      console.warn('   Ensure /var/shared-secrets is tmpfs in production');
      console.warn('   Ensure /var/secrets is NOT mounted (should be container-layer only)');
      return;
    }

    const mountLines = mounts.split('\n');

    // CRITICAL: Check that CONTAINER_SECRETS_PATH is NOT mounted
    const containerSecretsMount = mountLines.find(line => {
      const parts = line.split(' ');
      return parts.length >= 3 && parts[1] === CONTAINER_SECRETS_PATH;
    });

    if (containerSecretsMount) {
      console.error('❌ FATAL ERROR: /var/secrets must NOT be mounted as a volume!');
      console.error('   /var/secrets should only exist in the container layer (ephemeral storage).');
      console.error('   This ensures secrets injected via Docker Archive API are isolated per container.');
      console.error('   Please remove any volume mounts for /var/secrets from your docker-compose.yml');
      console.error('');
      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      }
      console.error('   Note: In development mode, starting anyway for testing purposes...');
      console.error('   WARNING: This would be a critical security risk in production!');
    }

    console.log('✓ Security check passed: /var/secrets is not mounted (container-layer only)');

    // Find the mount entry for DEPLOY_PATH
    const deployMount = mountLines.find(line => {
      const parts = line.split(' ');
      return parts.length >= 3 && parts[1] === DEPLOY_PATH;
    });

    if (deployMount) {
      const parts = deployMount.split(' ');
      const fsType = parts[2];

      if (fsType !== 'tmpfs') {
        console.error('❌ FATAL ERROR: /var/shared-secrets is not mounted as tmpfs!');
        console.error(`   Current filesystem type: ${fsType}`);
        console.error('   Security requirement: Decrypted secrets must be stored in memory-only (tmpfs) storage.');
        console.error('   Please update your docker-compose.yml:');
        console.error('');
        console.error('   volumes:');
        console.error('     shared-secrets-tmpfs:');
        console.error('       driver: local');
        console.error('       driver_opts:');
        console.error('         type: tmpfs');
        console.error('         device: tmpfs');
        console.error('         o: uid=1001,gid=1001,mode=700');
        console.error('');
        if (process.env.NODE_ENV === 'production') {
          process.exit(1);
        }
        console.error('   Note: In development mode, starting anyway for testing purposes...');
        console.error('   WARNING: This would be a critical security risk in production!');
      }

      console.log('✓ Security check passed: /var/shared-secrets is mounted as tmpfs');
    } else {
      console.warn('⚠️  Warning: /var/shared-secrets is not mounted (no entry in /proc/mounts)');
      console.warn('   Secrets will be stored on regular filesystem - not recommended for production');
      console.warn('   Consider mounting as tmpfs for better security');
    }
  } catch (err) {
    console.warn('⚠️  Warning: Failed to check /var/shared-secrets mount');
    console.warn('   Ensure /var/shared-secrets is tmpfs in production');
  }
}

// Run startup checks
(async () => {
  await checkSecretsMount();
})();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, '..', 'static')));

// Trust proxy for secure cookies behind reverse proxy
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Session middleware (required for OAuth2)
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== 'true',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax',
    },
    // Note: Using default MemoryStore - sessions won't persist across restarts
    // For production with multiple instances, use connect-redis or similar
  }),
);

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// Set EJS as templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Configure OAuth2 if enabled
if (isOAuth2Configured()) {
  (async () => {
    await configureOAuth2();
  })();
}

// Mount routers
app.use(healthRouter);
app.use(oauthRouter);
app.use(viewsRouter);
app.use(passwordRouter);
app.use('/services', servicesRouter);
app.use('/services', secretsRouter);
app.use('/deploy', deployRouter);
app.use('/api/services', apiServicesRouter);

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);

  // // Start watching for new Docker containers
  // try {
  //   startContainerWatcher();
  // } catch (err) {
  //   console.error('Failed to start container watcher:', err);
  //   console.log('Container auto-detection will not be available');
  // }
});

// Graceful shutdown handler with cleanup
const shutdown = async (signal: string) => {
  console.log(`\n${signal} received, shutting down gracefully...`);

  try {
    console.log('Purging /var/shared-secrets directory...');
    const entries = await fs.readdir(DEPLOY_PATH, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(DEPLOY_PATH, entry.name);
      if (entry.isDirectory()) {
        await fs.rm(fullPath, { recursive: true, force: true });
        continue;
      }
      await fs.unlink(fullPath);
    }
    console.log('✓ Shared secrets directory cleaned');
  } catch (err) {
    console.error('Failed to clean shared secrets directory:', err);
  }

  try {
    console.log('Purging /var/secrets directory...');
    const entries = await fs.readdir(CONTAINER_SECRETS_PATH, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(CONTAINER_SECRETS_PATH, entry.name);
      if (entry.isDirectory()) {
        await fs.rm(fullPath, { recursive: true, force: true });
        continue;
      }
      await fs.unlink(fullPath);
    }
    console.log('✓ Container secrets directory cleaned');
  } catch (err) {
    console.error('Failed to clean container secrets directory:', err);
  }

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
};

// Listen for termination signals (docker stop, docker compose down)
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
