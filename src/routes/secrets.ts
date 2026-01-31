import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { isAuthenticated } from '../utils/auth';
import { withPassphraseFile, validatePassword, encryptSecret } from '../utils/gpg';
import { buildServicesTree } from '../utils/services';
import { PASSWORD_STORE_PATH } from '../utils/config';
import { renderAlert, renderAlertAsync } from '../utils/render';

const execAsync = promisify(exec);
const router = Router();

// Create a new secret
router.post('/:serviceName/secrets', isAuthenticated, async (req: Request, res: Response) => {
  const { serviceName } = req.params;
  const { secretName, secretValue } = req.body;
  const password = req.headers['x-user-password'] as string;

  if (!secretName || !secretValue) {
    return renderAlert(res, 'error', 'Secret name and value are required', 400);
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(secretName)) {
    return renderAlert(res, 'error', 'Secret name can only contain letters, numbers, hyphens, and underscores', 400);
  }

  if (!password) {
    return res.status(401).send('<div class="alert alert-error">Password required</div>');
  }

  try {
    await fs.mkdir(PASSWORD_STORE_PATH, { recursive: true });

    const secretPath = path.join(PASSWORD_STORE_PATH, serviceName, `${secretName}.gpg`);
    const secretDir = path.dirname(secretPath);
    await fs.mkdir(secretDir, { recursive: true });

    await encryptSecret(secretValue, password, secretPath);

    const services = await buildServicesTree();
    res.render('partials/services_list', { services });
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

      const match = line.match(/^([a-zA-Z0-9_-]+)=(.*)$/);
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

    await fs.mkdir(PASSWORD_STORE_PATH, { recursive: true });
    const serviceDir = path.join(PASSWORD_STORE_PATH, serviceName);
    await fs.mkdir(serviceDir, { recursive: true });

    const importStats = { count: 0 };
    for (const secret of secrets) {
      try {
        const secretPath = path.join(serviceDir, `${secret.name}.gpg`);
        await encryptSecret(secret.value, password, secretPath);
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
      res.render('partials/bulk_import_result', { alertHtml, servicesListHtml: servicesList });
      return;
    }

    const alertHtml = await renderAlertAsync(res, 'success', `✓ Successfully imported ${importStats.count} secrets`);
    res.render('partials/bulk_import_result', { alertHtml, servicesListHtml: servicesList });
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
    const secretPath = path.join(PASSWORD_STORE_PATH, serviceName, `${secretName}.gpg`);
    const { stdout } = await withPassphraseFile(password, async passphraseFile => {
      return await execAsync(`gpg --batch --yes --passphrase-file ${passphraseFile} --decrypt ${secretPath}`);
    });

    res.render('partials/secret_view', { serviceName, secretName, secretValue: stdout.trim(), updated: false });
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
    const secretPath = path.join(PASSWORD_STORE_PATH, serviceName, `${secretName}.gpg`);

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
    const secretPath = path.join(PASSWORD_STORE_PATH, serviceName, `${secretName}.gpg`);
    const { stdout } = await withPassphraseFile(password, async passphraseFile => {
      return await execAsync(`gpg --batch --yes --passphrase-file ${passphraseFile} --decrypt ${secretPath}`);
    });

    res.render('partials/secret_edit', { serviceName, secretName, secretValue: stdout.trim() });
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

    const secretPath = path.join(PASSWORD_STORE_PATH, serviceName, `${secretName}.gpg`);
    await fs.unlink(secretPath);

    const services = await buildServicesTree();
    res.render('partials/services_list', { services });
  } catch (error: any) {
    renderAlert(res, 'error', `Failed to delete secret: ${error.message}`);
  }
});

export default router;
