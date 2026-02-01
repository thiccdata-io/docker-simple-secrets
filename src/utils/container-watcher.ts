import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { DEPLOY_PATH } from './config';

const execAsync = promisify(exec);

let hasDeployedOnce = false;
let watcherProcess: ReturnType<typeof exec> | null = null;

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
    const { stdout: containerJson } = await execAsync(
      `curl -s --unix-socket /var/run/docker.sock "http://localhost/containers/${containerId}/json"`,
    );
    const containerData = JSON.parse(containerJson);

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

      // Verify this is a known service
      try {
        await fs.access(serviceDeployPath);

        // Get original image info
        const image = containerData.Config?.Image || '';
        const { stdout: imageJson } = await execAsync(
          `curl -s --unix-socket /var/run/docker.sock "http://localhost/images/${encodeURIComponent(image)}/json"`,
        );
        const imageData = JSON.parse(imageJson);

        if (imageData.message) {
          throw new Error(`Image inspection failed: ${imageData.message}`);
        }

        // Extract original entrypoint and cmd from image
        const originalEntrypoint = imageData.Config?.Entrypoint || [];
        const originalCmd = imageData.Config?.Cmd || [];

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
  if (watcherProcess) {
    console.log('Container watcher already running');
    return;
  }

  console.log('Starting Docker container watcher...');

  // Use curl to stream Docker events, filtering for container start events
  // Note: The filters parameter needs to be properly URL-encoded
  const filters = encodeURIComponent(JSON.stringify({ type: ['container'], event: ['start'] }));
  watcherProcess = exec(
    `curl -s --no-buffer --unix-socket /var/run/docker.sock "http://localhost/events?filters=${filters}"`,
    { maxBuffer: 1024 * 1024 * 10 }, // 10MB buffer
  );

  if (watcherProcess.stdout) {
    watcherProcess.stdout.on('data', async (data: Buffer) => {
      try {
        // Docker events API returns newline-delimited JSON
        const lines = data
          .toString()
          .split('\n')
          .filter(line => line.trim());

        for (const line of lines) {
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
            // Ignore JSON parse errors (incomplete lines)
          }
        }
      } catch (err) {
        console.error('Error processing Docker event:', err);
      }
    });
  }

  if (watcherProcess.stderr) {
    watcherProcess.stderr.on('data', (data: Buffer) => {
      console.error('Container watcher error:', data.toString());
    });
  }

  watcherProcess.on('close', code => {
    console.log(`Container watcher stopped with code ${code}`);
    watcherProcess = null;

    // Auto-restart after a delay if it wasn't intentionally stopped
    if (code !== 0 && code !== null) {
      console.log('Restarting container watcher in 5 seconds...');
      setTimeout(() => startContainerWatcher(), 5000);
    }
  });

  console.log('✓ Container watcher started');
}

/**
 * Stop the container watcher
 */
export function stopContainerWatcher(): void {
  if (watcherProcess) {
    console.log('Stopping container watcher...');
    watcherProcess.kill();
    watcherProcess = null;
  }
}
