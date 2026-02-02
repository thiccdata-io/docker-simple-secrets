import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import { checkRateLimit, resetRateLimit, isOAuth2Configured } from '../utils/auth';
import { validatePassword, createPasswordValidation } from '../utils/crypto';
import { buildServicesTree } from '../utils/services';
import { DEPLOY_PATH } from '../utils/config';
import { renderAlert } from '../utils/render';

const router = Router();

// First-time setup password verification (no auth required)
router.post('/verify-password-setup', async (req: Request, res: Response) => {
  const { password } = req.body;
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  if (!password || password.length === 0) {
    return res.render('partials/password_error');
  }

  const rateLimit = checkRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return res.render('partials/password_error', { message: rateLimit.message });
  }

  try {
    const validation = await validatePassword(password);

    // If validation file exists, user should use the regular endpoint
    if (validation.success || validation.message !== 'Validation file not found') {
      return res.render('partials/password_error', { errorMessage: 'Password already set. Please use the login form.' });
    }

    // Create new password
    const result = await createPasswordValidation(password);
    if (!result.success) {
      return res.render('partials/password_error', { errorMessage: result.message });
    }

    resetRateLimit(clientIp);

    const services = await buildServicesTree();

    const shouldAutoDeploy = await (async () => {
      if (services.length === 0) {
        return false;
      }

      try {
        const deployStats = await fs.stat(DEPLOY_PATH);
        if (deployStats.isDirectory()) {
          const deployContents = await fs.readdir(DEPLOY_PATH);
          const hasRealContents = deployContents.some(item => !item.startsWith('.'));
          return !hasRealContents;
        }
        return false;
      } catch {
        return true;
      }
    })();

    res.render('partials/password_success', {
      keyMessage: 'Password set successfully - First time setup complete',
      services,
      autoDeployPassword: shouldAutoDeploy ? password : null,
    });
  } catch (error: any) {
    res.render('partials/password_error', { errorMessage: error.message || 'An unexpected error occurred' });
  }
});

// Regular password verification (requires OAuth2 auth if configured)
router.post('/verify-password', async (req: Request, res: Response) => {
  // Check OAuth2 authentication first if configured
  if (isOAuth2Configured() && !req.isAuthenticated()) {
    return renderAlert(res, 'error', 'Please authenticate with OAuth2 first', 401);
  }

  const { password } = req.body;
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  if (!password || password.length === 0) {
    return res.render('partials/password_error');
  }

  const rateLimit = checkRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return res.render('partials/password_error', { message: rateLimit.message });
  }

  try {
    const validation = await validatePassword(password);

    if (!validation.success) {
      return res.render('partials/password_error', { errorMessage: 'Invalid password. Please try again.' });
    }

    resetRateLimit(clientIp);

    const services = await buildServicesTree();

    const shouldAutoDeploy = await (async () => {
      if (services.length === 0) {
        return false;
      }

      try {
        const deployStats = await fs.stat(DEPLOY_PATH);
        if (deployStats.isDirectory()) {
          const deployContents = await fs.readdir(DEPLOY_PATH);
          const hasRealContents = deployContents.some(item => !item.startsWith('.'));
          return !hasRealContents;
        }
        return false;
      } catch {
        return true;
      }
    })();

    res.render('partials/password_success', {
      keyMessage: validation.message,
      services,
      autoDeployPassword: shouldAutoDeploy ? password : null,
    });
  } catch (error: any) {
    res.render('partials/password_error', { errorMessage: error.message || 'An unexpected error occurred' });
  }
});

export default router;
