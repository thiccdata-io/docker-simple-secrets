import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { isAuthenticated } from '../utils/auth';
import { validatePassword } from '../utils/crypto';
import { buildServicesTree } from '../utils/services';
import { SECRETS_STORE_PATH, DEPLOY_PATH } from '../utils/config';
import { renderAlert } from '../utils/render';

const router = Router();

// Get the services view section
router.get('/view', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const services = await buildServicesTree();
    res.render('partials/services_section', { services });
  } catch (error: any) {
    renderAlert(res, 'error', `Failed to load services: ${error.message}`);
  }
});

// Create a new service (directory)
router.post('/', isAuthenticated, async (req: Request, res: Response) => {
  const { serviceName } = req.body;

  if (!serviceName || serviceName.length === 0) {
    return renderAlert(res, 'error', 'Service name is required', 400);
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(serviceName)) {
    return renderAlert(res, 'error', 'Service name can only contain letters, numbers, hyphens, and underscores', 400);
  }

  try {
    const servicePath = path.join(SECRETS_STORE_PATH, serviceName);
    await fs.mkdir(servicePath, { recursive: true });

    const services = await buildServicesTree();
    res.render('partials/services_list', { services });
  } catch (error: any) {
    renderAlert(res, 'error', `Failed to create service: ${error.message}`);
  }
});

// Rename a service
router.put('/:serviceName', isAuthenticated, async (req: Request, res: Response) => {
  const { serviceName } = req.params;
  const { newName } = req.body;
  const password = req.headers['x-user-password'] as string;

  if (!password) {
    return renderAlert(res, 'error', 'Password required', 401);
  }

  if (!newName || newName.length === 0) {
    return renderAlert(res, 'error', 'New service name is required', 400);
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
    return renderAlert(res, 'error', 'Service name can only contain letters, numbers, hyphens, and underscores', 400);
  }

  try {
    const validation = await validatePassword(password);
    if (!validation.success) {
      return renderAlert(res, 'error', 'Invalid password', 401);
    }

    const oldPath = path.join(SECRETS_STORE_PATH, serviceName);
    const newPath = path.join(SECRETS_STORE_PATH, newName);

    try {
      await fs.access(newPath);
      return renderAlert(res, 'error', 'A service with this name already exists', 400);
    } catch {
      // New name doesn't exist - good to proceed
    }

    await fs.rename(oldPath, newPath);

    const oldDeployPath = path.join(DEPLOY_PATH, serviceName);
    try {
      await fs.access(oldDeployPath);
      await fs.rm(oldDeployPath, { recursive: true, force: true });
    } catch {
      // Deployed directory doesn't exist - that's ok
    }

    const services = await buildServicesTree();
    res.render('partials/services_list', { services });
  } catch (error: any) {
    renderAlert(res, 'error', `Failed to rename service: ${error.message}`);
  }
});

// Delete a service
router.delete('/:serviceName', isAuthenticated, async (req: Request, res: Response) => {
  const { serviceName } = req.params;
  const password = req.headers['x-user-password'] as string;

  if (!password) {
    return renderAlert(res, 'error', 'Password required', 401);
  }

  try {
    const validation = await validatePassword(password);
    if (!validation.success) {
      return renderAlert(res, 'error', 'Invalid password', 401);
    }

    const servicePath = path.join(SECRETS_STORE_PATH, serviceName);
    await fs.rm(servicePath, { recursive: true, force: true });

    const services = await buildServicesTree();
    res.render('partials/services_list', { services });
  } catch (error: any) {
    renderAlert(res, 'error', `Failed to delete service: ${error.message}`);
  }
});

export default router;
