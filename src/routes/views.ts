import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import { DEPLOY_PATH, PASSWORD_VALIDATION_FILE } from '../utils/config';
import { isOAuth2Configured } from '../utils/auth';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const tmpfsExists = await (async () => {
    try {
      const deployStats = await fs.stat(DEPLOY_PATH);
      if (deployStats.isDirectory()) {
        const deployContents = await fs.readdir(DEPLOY_PATH);
        return deployContents.some(item => !item.startsWith('.'));
      }
      return false;
    } catch {
      return false;
    }
  })();

  // Check if password has been set up (validation file exists)
  const passwordExists = await (async () => {
    try {
      await fs.access(PASSWORD_VALIDATION_FILE);
      return true;
    } catch {
      return false;
    }
  })();

  res.render('index', {
    title: 'Docker Simple Secrets',
    tmpfsExists,
    passwordExists,
    oauth2Enabled: isOAuth2Configured(),
    oauth2ProviderName: process.env.OAUTH2_PROVIDER_NAME || 'OAuth2 Provider',
    isAuthenticated: isOAuth2Configured() ? req.isAuthenticated() : false,
  });
});

export default router;
