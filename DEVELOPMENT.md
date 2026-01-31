# Development Guide

This guide covers local development setup for Docker Simple Secrets.

## Prerequisites

- Node.js 20.x or higher
- npm
- GPG command-line tools

## Installation

Clone the repository and install dependencies:

```bash
git clone <repository-url>
cd docker-simple-secrets
npm install
```

## Development Setup

### Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` for development:

```bash
# Basic Configuration
NODE_ENV=development
PORT=3000
SESSION_SECRET=dev-secret-change-in-production

# OAuth2 Configuration (Optional)
OAUTH2_ENABLED=true
OAUTH2_CLIENT_ID=your-dev-client-id
OAUTH2_CLIENT_SECRET=your-dev-client-secret
OAUTH2_ISSUER_URL=https://your-oauth-provider.com
OAUTH2_PROVIDER_NAME=GitHub
```

### Directory Structure

In development mode, the application uses local directories:

- **Encrypted secrets**: `./var/data/`
- **Decrypted secrets**: `./var/secrets/`

These directories are automatically created on first run.

## Running the Development Server

Start the development server with hot-reload:

```bash
npm run dev
```

The server will start at http://localhost:3000 with:

- TypeScript compilation via `ts-node`
- File watching with `--watch` flag
- Environment variables loaded from `.env`

## Building for Production

Compile TypeScript to JavaScript:

```bash
npm run build
```

This creates the `dist/` directory with compiled code.

## Running Production Build Locally

To test the production build locally:

```bash
npm run build
npm start
```

**Note**: This runs the compiled code but still uses local directories. For true production testing, use Docker.

## Project Structure

```
src/
├── server.ts              # Main Express application
├── routes/                # HTTP route handlers
│   ├── health.ts         # Health check endpoint
│   ├── oauth.ts          # OAuth2 authentication
│   ├── views.ts          # Main view rendering
│   ├── password.ts       # Password verification
│   ├── services.ts       # Service management
│   ├── secrets.ts        # Secret CRUD operations
│   └── deploy.ts         # Secret deployment
├── utils/                 # Utility modules
│   ├── config.ts         # Configuration constants
│   ├── auth.ts           # Authentication logic
│   ├── gpg.ts            # GPG encryption/decryption
│   ├── services.ts       # Service tree building
│   └── types.ts          # TypeScript interfaces
├── entrypoint.sh         # Container entrypoint script
views/                     # EJS templates
├── index.ejs             # Main page
└── partials/             # Reusable components
static/                    # Static assets
├── style.css             # Application styles
└── htmx.min.js           # HTMX library (auto-copied from node_modules)
```

## Development Workflow

### Adding a New Route

1. Create a router in `src/routes/`:

```typescript
import { Router } from 'express';
const router = Router();

router.get('/my-endpoint', (req, res) => {
  // Handle request
});

export default router;
```

2. Import and mount in `src/server.ts`:

```typescript
import myRouter from './routes/my-route';
app.use('/my-path', myRouter);
```

### Adding a New Utility

1. Create a module in `src/utils/`:

```typescript
export function myUtility() {
  // Implementation
}
```

2. Import where needed:

```typescript
import { myUtility } from '../utils/my-utility';
```

### Modifying Views

Edit EJS templates in `views/`:

- `index.ejs` - Main page structure
- `partials/` - Reusable components loaded with `<%- include('partial-name') %>`

Changes are reflected immediately (no rebuild needed).

### Modifying Styles

Edit `static/style.css` directly. Changes are reflected on page refresh.

## Testing with Docker Compose

Test the full Docker setup locally:

```bash
docker compose up --build
```

This builds the Docker image and starts all services defined in `docker-compose.yml`.

## Debugging

### TypeScript Debugging

The dev server runs with Node.js debugger enabled. In VS Code:

1. Set breakpoints in `.ts` files
2. Run the "Attach" debug configuration
3. Debugger will connect to the running process

### Viewing Logs

Development server logs to console with detailed output:

- HTTP requests
- OAuth2 configuration
- Secret deployment status
- Error traces

### Common Issues

**GPG command not found:**

```bash
# macOS
brew install gnupg

# Ubuntu/Debian
sudo apt-get install gnupg

# Alpine (for Docker)
apk add gnupg
```

**Permission errors on var/ directories:**

```bash
# Reset permissions
chmod -R 755 var/
```

**Port already in use:**

```bash
# Change PORT in .env
PORT=3001
```

## Code Style

See [CODE_STYLE.md](CODE_STYLE.md) for coding standards and best practices.

## Git Workflow

1. Create a feature branch:

```bash
git checkout -b feature/my-feature
```

2. Make changes and commit:

```bash
git add .
git commit -m "feat: add new feature"
```

3. Push and create pull request:

```bash
git push origin feature/my-feature
```

## TypeScript Configuration

The project uses strict TypeScript settings (`tsconfig.json`):

- `strict: true` - All strict checks enabled
- `target: ES2022` - Modern JavaScript features
- `module: commonjs` - Node.js compatibility
- `outDir: dist` - Compiled output directory

## Dependencies

### Production Dependencies

- `express` - Web framework
- `ejs` - Template engine
- `passport` + `passport-oauth2` - Authentication
- `express-session` - Session management
- `htmx.org` - HTMX library (auto-copied to static/)

### Development Dependencies

- `typescript` - TypeScript compiler
- `ts-node` - TypeScript execution
- `@types/*` - Type definitions
- `dotenv` - Environment variable loading

## Environment Variables Reference

| Variable               | Required  | Default           | Description                     |
| ---------------------- | --------- | ----------------- | ------------------------------- |
| `NODE_ENV`             | No        | `development`     | Environment mode                |
| `PORT`                 | No        | `3000`            | HTTP server port                |
| `SESSION_SECRET`       | Yes       | -                 | Session encryption key          |
| `OAUTH2_ENABLED`       | No        | `false`           | Enable OAuth2 authentication    |
| `OAUTH2_CLIENT_ID`     | If OAuth2 | -                 | OAuth2 client ID                |
| `OAUTH2_CLIENT_SECRET` | If OAuth2 | -                 | OAuth2 client secret            |
| `OAUTH2_ISSUER_URL`    | If OAuth2 | -                 | OAuth2 provider base URL        |
| `OAUTH2_PROVIDER_NAME` | No        | `OAuth2 Provider` | Display name                    |
| `OAUTH2_SCOPE`         | No        | `openid`          | OAuth2 scopes                   |
| `DSS_SERVICE_NAME`     | No        | -                 | Service name for secret loading |

## License

MIT
