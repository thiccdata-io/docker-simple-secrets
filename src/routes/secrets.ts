import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { isAuthenticated } from '../utils/auth';
import { decryptSecret, validatePassword, encryptSecret } from '../utils/crypto';
import { buildServicesTree } from '../utils/services';
import { SECRETS_STORE_PATH } from '../utils/config';
import { renderAlert, renderAlertAsync } from '../utils/render';
import { createDefaultState, toggleSecretMounted } from '../utils/secret-state';

const router = Router();

// Create a new secret (empty, value added later)
router.post('/:serviceName/secrets', isAuthenticated, async (req: Request, res: Response) => {
  const { serviceName } = req.params;
  const { secretName } = req.body;
  const password = req.headers['x-user-password'] as string;

  if (!secretName) {
    return renderAlert(res, 'error', 'Secret name is required', 400);
  }

  if (!/^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/.test(secretName)) {
    return renderAlert(
      res,
      'error',
      'Secret name must start with a letter, number, or underscore, and can contain letters, numbers, underscores, hyphens, and periods',
      400,
    );
  }

  if (!password) {
    return res.status(401).send('<div class="alert alert-error">Password required</div>');
  }

  try {
    await fs.mkdir(SECRETS_STORE_PATH, { recursive: true });

    const secretPath = path.join(SECRETS_STORE_PATH, serviceName, `${secretName}.aes`);
    const secretDir = path.dirname(secretPath);
    await fs.mkdir(secretDir, { recursive: true });

    // Create empty secret and default state
    await encryptSecret('', password, secretPath);
    await createDefaultState(serviceName, secretName);

    const services = await buildServicesTree();
    const servicesList = await new Promise<string>((resolve, reject) => {
      res.app.render('partials/services_list', { services }, (err: Error | null, html: string) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(html);
      });
    });

    const alertHtml = await renderAlertAsync(res, 'success', `✓ Secret '${secretName}' created. Click to edit and add a value.`);
    return res.send(`${alertHtml}${servicesList}`);
  } catch (error: any) {
    renderAlert(res, 'error', `Failed to create secret: ${error.message}`);
  }
});

// Bulk import secrets from .env format
router.post('/:serviceName/bulk-import', isAuthenticated, async (req: Request, res: Response) => {
  const { serviceName } = req.params;
  const { envContent } = req.body;
  const password = req.headers['x-user-password'] as string;

  if (!envContent) {
    return renderAlert(res, 'error', '.env content is required', 400);
  }

  if (!password) {
    return renderAlert(res, 'error', 'Password required', 401);
  }

  try {
    const lines = envContent.split('\n');
    const secrets: { name: string; value: string }[] = [];
    const errors: string[] = [];

    for (const [index, rawLine] of lines.entries()) {
      const line = rawLine.trim();

      if (!line || line.startsWith('#')) {
        continue;
      }

      const match = line.match(/^([a-zA-Z0-9_][a-zA-Z0-9._-]*)=(.*)$/);
      if (!match) {
        errors.push(`Line ${index + 1}: Invalid format`);
        continue;
      }

      const [, key, value] = match;
      const cleanValue = value.replace(/^["']|["']$/g, '');
      secrets.push({ name: key, value: cleanValue });
    }

    if (secrets.length === 0) {
      return renderAlert(res, 'error', 'No valid secrets found in .env content', 400);
    }

    await fs.mkdir(SECRETS_STORE_PATH, { recursive: true });
    const serviceDir = path.join(SECRETS_STORE_PATH, serviceName);
    await fs.mkdir(serviceDir, { recursive: true });

    const importStats = { count: 0 };
    for (const secret of secrets) {
      try {
        const secretPath = path.join(serviceDir, `${secret.name}.aes`);
        await encryptSecret(secret.value, password, secretPath);
        await createDefaultState(serviceName, secret.name);
        importStats.count++;
      } catch (err) {
        errors.push(`Failed to import ${secret.name}: ${err}`);
      }
    }

    const servicesTree = await buildServicesTree();

    const servicesList = await new Promise<string>((resolve, reject) => {
      res.app.render('partials/services_list', { services: servicesTree }, (err: Error | null, html: string) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(html);
      });
    });

    if (errors.length > 0) {
      const alertHtml = await renderAlertAsync(
        res,
        'warning',
        `⚠️ Imported ${importStats.count}/${secrets.length} secrets. Some errors occurred.`,
      );
      return res.send(`${alertHtml}${servicesList}`);
    }

    const alertHtml = await renderAlertAsync(res, 'success', `✓ Successfully imported ${importStats.count} secrets`);
    return res.send(`${alertHtml}${servicesList}`);
  } catch (error: any) {
    renderAlert(res, 'error', `Failed to import secrets: ${error.message}`);
  }
});

// Decrypt and view a secret
router.get('/:serviceName/secrets/:secretName', isAuthenticated, async (req: Request, res: Response) => {
  const { serviceName, secretName } = req.params;
  const password = req.headers['x-user-password'] as string;

  if (!password) {
    return renderAlert(res, 'error', 'Password required', 401);
  }

  try {
    const secretPath = path.join(SECRETS_STORE_PATH, serviceName, `${secretName}.aes`);
    const secretValue = await decryptSecret(secretPath, password);

    res.render('partials/secret_view', { serviceName, secretName, secretValue, updated: false });
  } catch (error: any) {
    renderAlert(res, 'error', `Failed to decrypt secret: ${error.message}`);
  }
});

// Update a secret
router.put('/:serviceName/secrets/:secretName', isAuthenticated, async (req: Request, res: Response) => {
  const { serviceName, secretName } = req.params;
  const { secretValue } = req.body;
  const password = req.headers['x-user-password'] as string;

  if (!secretValue) {
    return renderAlert(res, 'error', 'Secret value is required', 400);
  }

  if (!password) {
    return renderAlert(res, 'error', 'Password required', 401);
  }

  try {
    const secretPath = path.join(SECRETS_STORE_PATH, serviceName, `${secretName}.aes`);

    await encryptSecret(secretValue, password, secretPath);

    res.render('partials/secret_view', { serviceName, secretName, secretValue: secretValue.trim(), updated: true });
  } catch (error: any) {
    renderAlert(res, 'error', `Failed to update secret: ${error.message}`);
  }
});

// Get edit form for a secret
router.get('/:serviceName/secrets/:secretName/edit', isAuthenticated, async (req: Request, res: Response) => {
  const { serviceName, secretName } = req.params;
  const password = req.headers['x-user-password'] as string;

  if (!password) {
    return renderAlert(res, 'error', 'Password required', 401);
  }

  try {
    const secretPath = path.join(SECRETS_STORE_PATH, serviceName, `${secretName}.aes`);
    const secretValue = await decryptSecret(secretPath, password);

    res.render('partials/secret_edit', { serviceName, secretName, secretValue });
  } catch (error: any) {
    renderAlert(res, 'error', `Failed to load secret for editing: ${error.message}`);
  }
});

// Delete a secret
router.delete('/:serviceName/secrets/:secretName', isAuthenticated, async (req: Request, res: Response) => {
  const { serviceName, secretName } = req.params;
  const password = req.headers['x-user-password'] as string;

  if (!password) {
    return renderAlert(res, 'error', 'Password required', 401);
  }

  try {
    const validation = await validatePassword(password);
    if (!validation.success) {
      return renderAlert(res, 'error', 'Invalid password', 401);
    }

    const secretPath = path.join(SECRETS_STORE_PATH, serviceName, `${secretName}.aes`);
    const statePath = path.join(SECRETS_STORE_PATH, serviceName, `${secretName}.state`);

    // Delete both secret and state file
    await fs.unlink(secretPath);
    try {
      await fs.unlink(statePath);
    } catch (err) {
      // State file might not exist, that's okay
    }

    const services = await buildServicesTree();
    res.render('partials/services_list', { services });
  } catch (error: any) {
    renderAlert(res, 'error', `Failed to delete secret: ${error.message}`);
  }
});

// Rename a secret
router.put('/:serviceName/secrets/:secretName/rename', isAuthenticated, async (req: Request, res: Response) => {
  const { serviceName, secretName } = req.params;
  const { newSecretName } = req.body;
  const password = req.headers['x-user-password'] as string;

  if (!newSecretName) {
    return renderAlert(res, 'error', 'New secret name is required', 400);
  }

  if (!/^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/.test(newSecretName)) {
    return renderAlert(
      res,
      'error',
      'Secret name must start with a letter, number, or underscore, and can contain letters, numbers, underscores, hyphens, and periods',
      400,
    );
  }

  if (!password) {
    return renderAlert(res, 'error', 'Password required', 401);
  }

  try {
    const oldPath = path.join(SECRETS_STORE_PATH, serviceName, `${secretName}.aes`);
    const newPath = path.join(SECRETS_STORE_PATH, serviceName, `${newSecretName}.aes`);
    const oldStatePath = path.join(SECRETS_STORE_PATH, serviceName, `${secretName}.state`);
    const newStatePath = path.join(SECRETS_STORE_PATH, serviceName, `${newSecretName}.state`);

    // Check if new name already exists
    try {
      await fs.access(newPath);
      return renderAlert(res, 'error', `Secret '${newSecretName}' already exists`, 400);
    } catch {
      // File doesn't exist, which is good
    }

    await fs.rename(oldPath, newPath);

    // Rename state file if it exists
    try {
      await fs.rename(oldStatePath, newStatePath);
    } catch {
      // State file might not exist, that's okay
    }

    const services = await buildServicesTree();
    const servicesList = await new Promise<string>((resolve, reject) => {
      res.app.render('partials/services_list', { services }, (err: Error | null, html: string) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(html);
      });
    });

    const alertHtml = await renderAlertAsync(res, 'success', `✓ Secret renamed from '${secretName}' to '${newSecretName}'`);
    return res.send(`${alertHtml}${servicesList}`);
  } catch (error: any) {
    renderAlert(res, 'error', `Failed to rename secret: ${error.message}`);
  }
});

// Toggle mounted state for a secret
router.post('/:serviceName/secrets/:secretName/toggle-mount', isAuthenticated, async (req: Request, res: Response) => {
  const { serviceName, secretName } = req.params;

  try {
    const newMountedState = await toggleSecretMounted(serviceName, secretName);

    const services = await buildServicesTree();
    res.render('partials/services_list', { services });
  } catch (error: any) {
    renderAlert(res, 'error', `Failed to toggle mount state: ${error.message}`);
  }
});

export default router;
