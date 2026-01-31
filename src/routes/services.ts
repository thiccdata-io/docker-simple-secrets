import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { isAuthenticated } from '../utils/auth';
import { validatePassword } from '../utils/gpg';
import { buildServicesTree } from '../utils/services';
import { PASSWORD_STORE_PATH, DEPLOY_PATH } from '../utils/config';

const router = Router();

// Create a new service (directory)
router.post('/', isAuthenticated, async (req: Request, res: Response) => {
  const { serviceName } = req.body;

  if (!serviceName || serviceName.length === 0) {
    return res.status(400).send('<div class="alert alert-error">Service name is required</div>');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(serviceName)) {
    return res
      .status(400)
      .send('<div class="alert alert-error">Service name can only contain letters, numbers, hyphens, and underscores</div>');
  }

  try {
    const servicePath = path.join(PASSWORD_STORE_PATH, serviceName);
    await fs.mkdir(servicePath, { recursive: true });

    const services = await buildServicesTree();
    res.render('partials/services_list', { services });
  } catch (error: any) {
    res.status(500).send(`<div class="alert alert-error">Failed to create service: ${error.message}</div>`);
  }
});

// Rename a service
router.put('/:serviceName', isAuthenticated, async (req: Request, res: Response) => {
  const { serviceName } = req.params;
  const { newName } = req.body;
  const password = req.headers['x-user-password'] as string;

  if (!password) {
    return res.status(401).send('<div class="alert alert-error">Password required</div>');
  }

  if (!newName || newName.length === 0) {
    return res.status(400).send('<div class="alert alert-error">New service name is required</div>');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
    return res
      .status(400)
      .send('<div class="alert alert-error">Service name can only contain letters, numbers, hyphens, and underscores</div>');
  }

  try {
    const validation = await validatePassword(password);
    if (!validation.success) {
      return res.status(401).send('<div class="alert alert-error">Invalid password</div>');
    }

    const oldPath = path.join(PASSWORD_STORE_PATH, serviceName);
    const newPath = path.join(PASSWORD_STORE_PATH, newName);

    try {
      await fs.access(newPath);
      return res.status(400).send('<div class="alert alert-error">A service with this name already exists</div>');
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
    res.status(500).send(`<div class="alert alert-error">Failed to rename service: ${error.message}</div>`);
  }
});

// Delete a service
router.delete('/:serviceName', isAuthenticated, async (req: Request, res: Response) => {
  const { serviceName } = req.params;
  const password = req.headers['x-user-password'] as string;

  if (!password) {
    return res.status(401).send('<div class="alert alert-error">Password required</div>');
  }

  try {
    const validation = await validatePassword(password);
    if (!validation.success) {
      return res.status(401).send('<div class="alert alert-error">Invalid password</div>');
    }

    const servicePath = path.join(PASSWORD_STORE_PATH, serviceName);
    await fs.rm(servicePath, { recursive: true, force: true });

    const services = await buildServicesTree();
    res.render('partials/services_list', { services });
  } catch (error: any) {
    res.status(500).send(`<div class="alert alert-error">Failed to delete service: ${error.message}</div>`);
  }
});

export default router;
