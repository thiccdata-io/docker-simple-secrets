import fs from 'fs/promises';
import path from 'path';
import { Service, Secret } from './types';
import { SECRETS_STORE_PATH, CONTAINER_SECRETS_PATH } from './config';
import { calculateMD5 } from './crypto';
import { readSecretState } from './secret-state';

export async function checkSecretDeploymentStatus(
  serviceName: string,
  secretName: string,
): Promise<{ isDeployed: boolean; hasChanges: boolean }> {
  try {
    const secretPath = path.join(SECRETS_STORE_PATH, serviceName, `${secretName}.aes`);
    const statePath = path.join(SECRETS_STORE_PATH, serviceName, `${secretName}.state`);
    const md5Path = path.join(CONTAINER_SECRETS_PATH, serviceName, `${secretName}.md5`);

    try {
      await fs.access(md5Path);
    } catch {
      return { isDeployed: false, hasChanges: false };
    }

    // Calculate combined hash of secret + state
    const secretHash = await calculateMD5(secretPath);
    const stateHash = await calculateMD5(statePath);
    const currentHash = `${secretHash}:${stateHash}`;

    const deployedHash = (await fs.readFile(md5Path, 'utf-8')).trim();

    return { isDeployed: true, hasChanges: currentHash !== deployedHash };
  } catch (error) {
    return { isDeployed: false, hasChanges: false };
  }
}

export async function buildServicesTree(): Promise<Service[]> {
  try {
    const entries = await fs.readdir(SECRETS_STORE_PATH, { withFileTypes: true });
    const services: Service[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const servicePath = path.join(SECRETS_STORE_PATH, entry.name);
        const secrets: Secret[] = [];

        try {
          const secretFiles = await fs.readdir(servicePath, { withFileTypes: true });
          for (const file of secretFiles) {
            if (file.isFile() && file.name.endsWith('.aes')) {
              const secretName = file.name.replace('.aes', '');
              const deploymentStatus = await checkSecretDeploymentStatus(entry.name, secretName);
              const state = await readSecretState(entry.name, secretName);
              secrets.push({
                name: secretName,
                path: `${entry.name}/${file.name}`,
                isDeployed: deploymentStatus.isDeployed,
                hasChanges: deploymentStatus.hasChanges,
                mounted: state.mounted,
              });
            }
          }
        } catch (err) {
          // Skip if can't read directory
        }

        services.push({ name: entry.name, secrets });
      }
    }

    return services;
  } catch (error) {
    return [];
  }
}
