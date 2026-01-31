import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { isAuthenticated, isOAuth2Configured, loadSecretsFromFilesystem, configureOAuth2 } from '../utils/auth';
import { validatePassword, withPassphraseFile, calculateMD5 } from '../utils/gpg';
import { buildServicesTree } from '../utils/services';
import { PASSWORD_STORE_PATH, DEPLOY_PATH, OAUTH2_ENABLED } from '../utils/config';
import { DeployStats } from '../utils/types';
import { renderAlert } from '../utils/render';

const execAsync = promisify(exec);
const router = Router();

router.post('/', isAuthenticated, async (req: Request, res: Response) => {
  const password = req.headers['x-user-password'] as string;

  if (!password) {
    return renderAlert(res, 'error', 'Password required', 401);
  }

  try {
    const validation = await validatePassword(password);
    if (!validation.success) {
      return renderAlert(res, 'error', 'Invalid password', 401);
    }

    await fs.mkdir(DEPLOY_PATH, { recursive: true });

    const services = await buildServicesTree();
    const deployStats: DeployStats = { deployed: 0, updated: 0, skipped: 0, deleted: 0 };
    const validSecrets = new Set<string>();

    // Process all services in parallel
    await Promise.all(
      services.map(async service => {
        const serviceDeployPath = path.join(DEPLOY_PATH, service.name);
        await fs.mkdir(serviceDeployPath, { recursive: true });

        // Process all secrets within a service in parallel
        const results = await Promise.allSettled(
          service.secrets.map(async secret => {
            const secretPath = path.join(PASSWORD_STORE_PATH, service.name, `${secret.name}.gpg`);
            const deployFilePath = path.join(serviceDeployPath, secret.name);
            const md5FilePath = path.join(serviceDeployPath, `${secret.name}.md5`);

            validSecrets.add(`${service.name}/${secret.name}`);

            // Calculate MD5 hash
            const currentHash = await calculateMD5(secretPath);

            // Check if update is needed
            const existingHash = await (async (): Promise<string | null> => {
              try {
                return (await fs.readFile(md5FilePath, 'utf-8')).trim();
              } catch {
                return null;
              }
            })();

            if (existingHash === currentHash) {
              return { status: 'skipped' as const };
            }

            // Check if was previously deployed
            const wasDeployed = existingHash !== null;

            // Decrypt and deploy
            const { stdout } = await withPassphraseFile(password, async passphraseFile => {
              return await execAsync(`gpg --batch --yes --passphrase-file ${passphraseFile} --decrypt ${secretPath}`);
            });

            // Write both files in parallel
            await Promise.all([fs.writeFile(deployFilePath, stdout.trim()), fs.writeFile(md5FilePath, currentHash)]);

            return { status: wasDeployed ? ('updated' as const) : ('deployed' as const) };
          }),
        );

        // Aggregate results
        for (const result of results) {
          if (result.status === 'fulfilled') {
            deployStats[result.value.status]++;
          } else {
            console.error(`Failed to deploy secret:`, result.reason);
          }
        }
      }),
    );

    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    try {
      const entrypointContent = await fs.readFile(entrypointPath, 'utf-8');
      const deployEntrypointPath = path.join(DEPLOY_PATH, 'entrypoint.sh');
      await fs.writeFile(deployEntrypointPath, entrypointContent, { mode: 0o755 });
    } catch (err) {
      console.error('Failed to copy entrypoint script:', err);
    }

    // Clean up old deployments in parallel
    try {
      const deployedServices = await fs.readdir(DEPLOY_PATH, { withFileTypes: true });
      const cleanupOperations = deployedServices
        .filter(deployedService => deployedService.isDirectory())
        .map(async deployedService => {
          const servicePath = path.join(DEPLOY_PATH, deployedService.name);
          const deployedFiles = await fs.readdir(servicePath, { withFileTypes: true });

          const deleteOperations = deployedFiles
            .filter(file => file.isFile() && !file.name.endsWith('.md5'))
            .map(async file => {
              const secretName = file.name;
              const secretKey = `${deployedService.name}/${secretName}`;

              if (!validSecrets.has(secretKey)) {
                await Promise.allSettled([
                  fs.unlink(path.join(servicePath, file.name)),
                  fs.unlink(path.join(servicePath, `${secretName}.md5`)),
                ]);
                return true;
              }
              return false;
            });

          const results = await Promise.all(deleteOperations);
          return results.filter(deleted => deleted).length;
        });

      const deleteCounts = await Promise.all(cleanupOperations);
      deployStats.deleted = deleteCounts.reduce((sum, count) => sum + count, 0);
    } catch (err) {
      console.error('Failed to clean up old deployments:', err);
    }

    const updatedServices = await buildServicesTree();

    const statusParts = [];
    if (deployStats.deployed > 0) {
      statusParts.push(`${deployStats.deployed} new`);
    }
    if (deployStats.updated > 0) {
      statusParts.push(`${deployStats.updated} updated`);
    }
    if (deployStats.skipped > 0) {
      statusParts.push(`${deployStats.skipped} unchanged`);
    }
    if (deployStats.deleted > 0) {
      statusParts.push(`${deployStats.deleted} removed`);
    }

    const statusMessage = statusParts.length > 0 ? `✓ Deployment complete: ${statusParts.join(', ')}` : '✓ All secrets up to date';

    if (OAUTH2_ENABLED && !isOAuth2Configured() && deployStats.deployed > 0) {
      console.log('');
      console.log('🔄 Initial deployment complete. Loading OAuth2 secrets...');

      const serviceName = process.env.DSS_SERVICE_NAME;
      if (serviceName) {
        const loaded = await loadSecretsFromFilesystem(serviceName);
        if (loaded) {
          console.log('✓ Secrets loaded into environment');

          const configured = await configureOAuth2();
          if (configured) {
            console.log('✓ OAuth2 configured successfully');
            console.log('⚠️  Please refresh the page to use SSO authentication');

            res.render('partials/oauth2_enabled', { statusMessage });
            console.log('');
            return;
          } else {
            console.log('⚠️  OAuth2 configuration failed - check your secrets');
          }
          console.log('');
        }
      }
    }

    const servicesListHtml = await new Promise<string>((resolve, reject) => {
      res.app.render('partials/services_list', { services: updatedServices }, (err: Error | null, html: string) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(html);
      });
    });

    res.render('partials/deploy_result', { statusMessage, servicesListHtml });
  } catch (error: any) {
    renderAlert(res, 'error', `Failed to deploy: ${error.message}`);
  }
});

export default router;
