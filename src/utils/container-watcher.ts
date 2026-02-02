import fs from 'fs/promises';
import path from 'path';
import * as http from 'http';
import { DEPLOY_PATH, SECRETS_STORE_PATH } from './config';
import { readSecretState } from './secret-state';
import { dockerApiGet } from './docker';

/**
 * This pattern might get deprecated, or migrated into a hot reload pattern
 */

const DOCKER_SOCK = '/var/run/docker.sock';

let hasDeployedOnce = false;
let watcherRequest: http.ClientRequest | null = null;

/**
 * Mark that a deployment has occurred, enabling the watcher to generate container info files
 */
export function markDeploymentOccurred(): void {
  hasDeployedOnce = true;
}

/**
 * Check if deployment has occurred at least once
 */
export function hasDeployed(): boolean {
  return hasDeployedOnce;
}

/**
 * Generate .container-info file for a specific container
 */
export async function generateContainerInfo(containerId: string): Promise<void> {
  if (!hasDeployedOnce) {
    console.log('Skipping container info generation - no deployment has occurred yet');
    return;
  }

  try {
    // Get full container details
    const containerData = await dockerApiGet(`/containers/${containerId}/json`);

    if (containerData.message) {
      throw new Error(containerData.message);
    }

    // Check if this container is using our entrypoint
    const entrypoint = containerData.Config?.Entrypoint || [];
    const args = containerData.Args || [];

    // Look for dss-entrypoint-wrapper.sh in the entrypoint
    const usingDSSEntrypoint = entrypoint.some((entry: string) => entry.includes('dss-entrypoint-wrapper.sh'));

    if (usingDSSEntrypoint && args.length > 0) {
      // First arg should be the service name
      const serviceName = args[1];
      const serviceDeployPath = path.join(DEPLOY_PATH, serviceName);
      const serviceSecretsPath = path.join(SECRETS_STORE_PATH, serviceName);

      // Verify this is a known service
      try {
        await fs.access(serviceSecretsPath);
        // Check if any secrets are mounted (shared)
        const secretFiles = await fs.readdir(serviceSecretsPath);
        const secretNames = secretFiles.filter(file => file.endsWith('.aes')).map(file => file.replace('.aes', ''));

        let hasMountedSecrets = false;
        for (const secretName of secretNames) {
          const state = await readSecretState(serviceName, secretName);
          if (state.mounted) {
            hasMountedSecrets = true;
            break;
          }
        }

        // Only create .container-info if service has mounted secrets
        if (!hasMountedSecrets) {
          return;
        }

        // Ensure deploy path exists
        await fs.mkdir(serviceDeployPath, { recursive: true });
        // Get original image info
        const image = containerData.Config?.Image || '';
        const imageData = await dockerApiGet(`/images/${encodeURIComponent(image)}/json`);

        if (imageData.message) {
          throw new Error(`Image inspection failed: ${imageData.message}`);
        }

        // Extract original entrypoint and cmd from image
        const originalEntrypoint = imageData.Config?.Entrypoint || [];
        const originalCmd = imageData.Config?.Cmd || [];

        // Get container labels
        const labels = containerData.Config?.Labels || {};
        const labelLines = Object.entries(labels).map(
          ([key, value]) => `LABEL_${key.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase()}="${String(value).replace(/"/g, '\\"')}"`,
        );

        // Write container info as a sourceable shell script
        // This is much more reliable than JSON parsing with sed
        const entrypointStr = originalEntrypoint.join(' ');
        const cmdStr = originalCmd.join(' ');
        const containerInfoContent = [
          '#!/bin/sh',
          '# Auto-generated container info - do not edit manually',
          `# Updated: ${new Date().toISOString()}`,
          '',
          `ORIGINAL_ENTRYPOINT="${entrypointStr.replace(/"/g, '\\"')}"`,
          `ORIGINAL_CMD="${cmdStr.replace(/"/g, '\\"')}"`,
          `ORIGINAL_IMAGE="${image.replace(/"/g, '\\"')}"`,
          `ORIGINAL_WORKDIR="${imageData.Config?.WorkingDir || ''}"`,
          '',
          '# Container Labels',
          ...labelLines,
          '',
        ].join('\n');

        const containerInfoPath = path.join(serviceDeployPath, '.container-info');
        await fs.writeFile(containerInfoPath, containerInfoContent);

        const containerName = containerData.Name?.replace(/^\//, '') || containerId.substring(0, 12);
        console.log(`✓ Generated container info for service: ${serviceName} (container: ${containerName})`);
      } catch (err: any) {
        // Service directory doesn't exist or other error
        if (err.code !== 'ENOENT') {
          console.error(`Failed to generate container info for ${serviceName}:`, err.message);
        }
      }
    }
  } catch (err: any) {
    console.error(`Failed to process container ${containerId}:`, err.message);
  }
}

/**
 * Start watching for new Docker container start events
 */
export function startContainerWatcher(): void {
  if (watcherRequest) {
    console.log('Container watcher already running');
    return;
  }

  console.log('Starting Docker container watcher...');

  // Use http module to stream Docker events
  const filters = encodeURIComponent(JSON.stringify({ type: ['container'], event: ['start'] }));
  const options = { socketPath: DOCKER_SOCK, path: `/events?filters=${filters}`, method: 'GET' };

  watcherRequest = http.get(options, res => {
    console.log('✓ Container watcher started');

    let buffer = '';

    res.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');

      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line);

          if (event.Type === 'container' && event.Action === 'start') {
            const containerId = event.Actor?.ID || event.id;
            if (containerId) {
              console.log(`Container started: ${containerId.substring(0, 12)}`);
              // Generate container info asynchronously
              generateContainerInfo(containerId).catch(err => {
                console.error('Error generating container info:', err);
              });
            }
          }
        } catch (parseErr) {
          // Ignore JSON parse errors
        }
      }
    });

    res.on('end', () => {
      console.log('Container watcher stream ended');
      watcherRequest = null;

      // Auto-restart after a delay
      console.log('Restarting container watcher in 5 seconds...');
      setTimeout(() => startContainerWatcher(), 5000);
    });

    res.on('error', err => {
      console.error('Container watcher response error:', err);
      watcherRequest = null;

      // Auto-restart after a delay
      console.log('Restarting container watcher in 5 seconds...');
      setTimeout(() => startContainerWatcher(), 5000);
    });
  });

  watcherRequest.on('error', err => {
    console.error('Container watcher request error:', err);
    watcherRequest = null;

    // Auto-restart after a delay
    console.log('Restarting container watcher in 5 seconds...');
    setTimeout(() => startContainerWatcher(), 5000);
  });
}

/**
 * Stop the container watcher
 */
export function stopContainerWatcher(): void {
  if (watcherRequest) {
    console.log('Stopping container watcher...');
    watcherRequest.destroy();
    watcherRequest = null;
  }
}
