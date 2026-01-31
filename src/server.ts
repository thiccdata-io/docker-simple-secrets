import express from 'express';
import path from 'path';
import session from 'express-session';
import passport from 'passport';
import fs from 'fs/promises';
import { PORT, SESSION_SECRET, DEPLOY_PATH } from './utils/config';
import { isOAuth2Configured, configureOAuth2 } from './utils/auth';

// Import routers
import healthRouter from './routes/health';
import oauthRouter from './routes/oauth';
import viewsRouter from './routes/views';
import passwordRouter from './routes/password';
import servicesRouter from './routes/services';
import secretsRouter from './routes/secrets';
import deployRouter from './routes/deploy';

const app = express();

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

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// Graceful shutdown handler with cleanup
const shutdown = async (signal: string) => {
  console.log(`\n${signal} received, shutting down gracefully...`);

  try {
    console.log('Purging /var/secrets directory...');
    const entries = await fs.readdir(DEPLOY_PATH, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(DEPLOY_PATH, entry.name);
      if (entry.isDirectory()) {
        await fs.rm(fullPath, { recursive: true, force: true });
        continue;
      }
      await fs.unlink(fullPath);
    }
    console.log('✓ Secrets directory cleaned');
  } catch (err) {
    console.error('Failed to clean secrets directory:', err);
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
