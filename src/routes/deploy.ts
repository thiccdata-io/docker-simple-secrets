import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { isAuthenticated, isOAuth2Configured, loadSecretsFromFilesystem, configureOAuth2 } from '../utils/auth';
import { validatePassword, decryptSecret, calculateMD5 } from '../utils/crypto';
import { buildServicesTree } from '../utils/services';
import { SECRETS_STORE_PATH, DEPLOY_PATH, CONTAINER_SECRETS_PATH, OAUTH2_ENABLED } from '../utils/config';
import { DeployStats } from '../utils/types';
import { readSecretState } from '../utils/secret-state';
import { renderAlert } from '../utils/render';
import { markDeploymentOccurred, generateContainerInfo } from '../utils/container-watcher';
// import { dockerApiGet } from '../utils/docker';

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

    // Create both deployment directories
    await Promise.all([fs.mkdir(DEPLOY_PATH, { recursive: true }), fs.mkdir(CONTAINER_SECRETS_PATH, { recursive: true })]);

    const services = await buildServicesTree();
    const deployStats: DeployStats = { deployed: 0, updated: 0, skipped: 0, deleted: 0 };
    const validSecrets = new Set<string>();

    // Process all services in parallel
    await Promise.all(
      services.map(async service => {
        const serviceDeployPath = path.join(DEPLOY_PATH, service.name);
        const serviceContainerPath = path.join(CONTAINER_SECRETS_PATH, service.name);
        await Promise.all([fs.mkdir(serviceDeployPath, { recursive: true }), fs.mkdir(serviceContainerPath, { recursive: true })]);

        // Process all secrets within a service in parallel
        const results = await Promise.allSettled(
          service.secrets.map(async secret => {
            const secretPath = path.join(SECRETS_STORE_PATH, service.name, `${secret.name}.aes`);
            const statePath = path.join(SECRETS_STORE_PATH, service.name, `${secret.name}.state`);
            const state = await readSecretState(service.name, secret.name);

            // Always deploy to container path (for Docker Archive API)
            const containerFilePath = path.join(serviceContainerPath, secret.name);
            const containerMd5Path = path.join(serviceContainerPath, `${secret.name}.md5`);

            // Only deploy to shared path if mounted=true
            const sharedFilePath = state.mounted ? path.join(serviceDeployPath, secret.name) : null;
            const sharedMd5Path = state.mounted ? path.join(serviceDeployPath, `${secret.name}.md5`) : null;

            validSecrets.add(`${service.name}/${secret.name}`);

            // Calculate combined hash of secret + state
            const secretHash = await calculateMD5(secretPath);
            const stateHash = await calculateMD5(statePath);
            const currentHash = `${secretHash}:${stateHash}`;

            // Check if update is needed (check container path)
            const existingHash = await (async (): Promise<string | null> => {
              try {
                return (await fs.readFile(containerMd5Path, 'utf-8')).trim();
              } catch {
                return null;
              }
            })();

            if (existingHash === currentHash) {
              return { status: 'skipped' as const };
            }

            // Check if was previously deployed
            const wasDeployed = existingHash !== null;

            // Decrypt secret
            const decrypted = await decryptSecret(secretPath, password);

            // Write to container path (always) and shared path (if mounted)
            const writeOps = [fs.writeFile(containerFilePath, decrypted), fs.writeFile(containerMd5Path, currentHash)];

            if (state.mounted && sharedFilePath && sharedMd5Path) {
              writeOps.push(fs.writeFile(sharedFilePath, decrypted));
              writeOps.push(fs.writeFile(sharedMd5Path, currentHash));
            }

            await Promise.all(writeOps);

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

    const entrypointPath = path.join(__dirname, '..', 'dss-entrypoint-wrapper.sh');
    try {
      let entrypointContent = await fs.readFile(entrypointPath, 'utf-8');

      // Update CONFIG_SERVICE URL to point to this service
      const hostname = process.env.HOSTNAME || 'localhost';
      const port = process.env.PORT || '3000';
      const configServiceUrl = `http://${hostname}:${port}`;
      entrypointContent = entrypointContent.replace(/CONFIG_SERVICE=.*/, `CONFIG_SERVICE="${configServiceUrl}"`);

      const deployEntrypointPath = path.join(DEPLOY_PATH, 'dss-entrypoint-wrapper.sh');
      await fs.writeFile(deployEntrypointPath, entrypointContent, { mode: 0o755 });
      console.log(`✓ Deployed entrypoint script`);
    } catch (err) {
      console.error('Failed to copy entrypoint script:', err);
    }

    // Write .container-info files for each service by checking running containers
    // TODO: Migrate this logic to instead live update containers for "watchers"
    // try {
    //   console.log('Checking for containers using DSS entrypoint...');
    //   const containers = await dockerApiGet('/containers/json?all=false');

    //   // Generate container info for all running containers in parallel
    //   await Promise.all(containers.map((container: any) => generateContainerInfo(container.Id)));
    // } catch (err) {
    //   console.error('Failed to write container info files:', err);
    // }

    // Mark that deployment has occurred (enables container watcher)
    markDeploymentOccurred();

    // Clean up old deployments in both paths
    try {
      await Promise.all([
        // Cleanup DEPLOY_PATH (shared secrets)
        (async () => {
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
          return deleteCounts.reduce((sum, count) => sum + count, 0);
        })(),
        // Cleanup CONTAINER_SECRETS_PATH (container-level secrets)
        (async () => {
          const deployedServices = await fs.readdir(CONTAINER_SECRETS_PATH, { withFileTypes: true });
          const cleanupOperations = deployedServices
            .filter(deployedService => deployedService.isDirectory())
            .map(async deployedService => {
              const servicePath = path.join(CONTAINER_SECRETS_PATH, deployedService.name);
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
          return deleteCounts.reduce((sum, count) => sum + count, 0);
        })(),
      ]).then(([sharedDeleted, containerDeleted]) => {
        deployStats.deleted = sharedDeleted + containerDeleted;
      });
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
