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

const execAsync = promisify(exec);
const router = Router();

router.post('/', isAuthenticated, async (req: Request, res: Response) => {
  const password = req.headers['x-user-password'] as string;

  if (!password) {
    return res.status(401).send('<div class="alert alert-error">Password required</div>');
  }

  try {
    const validation = await validatePassword(password);
    if (!validation.success) {
      return res.status(401).send('<div class="alert alert-error">Invalid password</div>');
    }

    await fs.mkdir(DEPLOY_PATH, { recursive: true });

    const services = await buildServicesTree();
    const deployStats: DeployStats = { deployed: 0, updated: 0, skipped: 0, deleted: 0 };
    const validSecrets = new Set<string>();

    for (const service of services) {
      const serviceDeployPath = path.join(DEPLOY_PATH, service.name);
      await fs.mkdir(serviceDeployPath, { recursive: true });

      for (const secret of service.secrets) {
        try {
          const secretPath = path.join(PASSWORD_STORE_PATH, service.name, `${secret.name}.gpg`);
          const deployFilePath = path.join(serviceDeployPath, `${secret.name}.txt`);
          const md5FilePath = path.join(serviceDeployPath, `${secret.name}.txt.md5`);

          validSecrets.add(`${service.name}/${secret.name}`);

          const currentHash = await calculateMD5(secretPath);

          const needsUpdate = await (async () => {
            try {
              const existingHash = (await fs.readFile(md5FilePath, 'utf-8')).trim();
              if (existingHash === currentHash) {
                deployStats.skipped++;
                return false;
              }
              return true;
            } catch {
              return true;
            }
          })();

          if (needsUpdate) {
            const { stdout } = await withPassphraseFile(password, async passphraseFile => {
              return await execAsync(`gpg --batch --yes --passphrase-file ${passphraseFile} --decrypt ${secretPath}`);
            });

            await fs.writeFile(deployFilePath, stdout);

            const wasDeployed = await (async () => {
              try {
                await fs.access(md5FilePath);
                return true;
              } catch {
                return false;
              }
            })();

            await fs.writeFile(md5FilePath, currentHash);

            if (wasDeployed) {
              deployStats.updated++;
            } else {
              deployStats.deployed++;
            }
          }
        } catch (err) {
          console.error(`Failed to deploy ${service.name}/${secret.name}:`, err);
        }
      }
    }

    const entrypointPath = path.join(__dirname, '..', 'entrypoint.sh');
    try {
      const entrypointContent = await fs.readFile(entrypointPath, 'utf-8');
      const deployEntrypointPath = path.join(DEPLOY_PATH, 'entrypoint.sh');
      await fs.writeFile(deployEntrypointPath, entrypointContent, { mode: 0o755 });
    } catch (err) {
      console.error('Failed to copy entrypoint script:', err);
    }

    try {
      const deployedServices = await fs.readdir(DEPLOY_PATH, { withFileTypes: true });
      for (const deployedService of deployedServices) {
        if (deployedService.isDirectory()) {
          const servicePath = path.join(DEPLOY_PATH, deployedService.name);
          const deployedFiles = await fs.readdir(servicePath, { withFileTypes: true });

          for (const file of deployedFiles) {
            if (file.isFile() && file.name.endsWith('.txt')) {
              const secretName = file.name.replace('.txt', '');
              const secretKey = `${deployedService.name}/${secretName}`;

              if (!validSecrets.has(secretKey)) {
                await fs.unlink(path.join(servicePath, file.name));
                await fs.unlink(path.join(servicePath, `${secretName}.txt.md5`)).catch(() => {});
                deployStats.deleted++;
              }
            }
          }
        }
      }
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

            res.send(`
              <div id="services-list">
                <div class="alert alert-success">${statusMessage}</div>
                <div class="alert alert-info" style="margin-top: 1rem;">
                  <h3>🔐 OAuth2 Authentication Enabled</h3>
                  <p>Your secrets have been deployed and OAuth2 has been configured.</p>
                  <p><strong>Please refresh this page to authenticate with your identity provider.</strong></p>
                  <button onclick="window.location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Refresh Page
                  </button>
                </div>
              </div>
            `);
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

    res.send(`
      <div id="services-list">
        <div class="alert alert-success">${statusMessage}</div>
        ${servicesListHtml}
      </div>
    `);
  } catch (error: any) {
    res.status(500).send(`<div class="alert alert-error">Failed to deploy: ${error.message}</div>`);
  }
});

export default router;
