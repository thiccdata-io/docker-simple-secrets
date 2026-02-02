import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { dockerApiGet } from '../utils/docker';
import { buildServicesTree } from '../utils/services';
import { CONTAINER_SECRETS_PATH } from '../utils/config';

// /api/secrets base router
const router = Router();

/**
 * Middleware to find container by requesting IP address
 */
router.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get the requesting IP address
    const requestIp = req.ip || req.socket.remoteAddress || '';

    console.debug(`Looking up container for request IP: ${requestIp}`);

    // Normalize IPv6 localhost to IPv4
    const normalizedIp = requestIp.replace(/^::ffff:/, '');

    // Get all running containers
    const containers = await dockerApiGet('/containers/json?all=false');

    // Find container matching the IP address
    for (const container of containers) {
      const containerDetails = await dockerApiGet(`/containers/${container.Id}/json`);
      const networks = containerDetails.NetworkSettings?.Networks || {};

      // Check all networks for matching IP
      for (const [networkName, networkConfig] of Object.entries(networks)) {
        const containerIp = (networkConfig as any)?.IPAddress;

        if (containerIp === normalizedIp) {
          // Store container info on request
          req.containerInfo = {
            id: container.Id,
            name: containerDetails.Name?.replace(/^\//, '') || container.Id.substring(0, 12),
            image: containerDetails.Config?.Image || '',
            ipAddress: containerIp,
            labels: containerDetails.Config?.Labels || {},
            entrypoint: containerDetails.Config?.Entrypoint,
            args: containerDetails.Config?.Args,
            cmd: containerDetails.Config?.Cmd,
          };

          return next();
        }
      }
    }

    // No container found for this IP
    return res.status(403).json({ error: 'Forbidden: Container not found for requesting IP' });
  } catch (err: any) {
    console.error('Error looking up container by IP:', err.message);
    return res.status(403).json({ error: 'Forbidden: Unable to verify container' });
  }
});

router.get('/.container-info', async (req: Request, res: Response) => {
  try {
    const containerInfo = req.containerInfo;
    if (!containerInfo) {
      return res.status(400).send('# Error: Container info not found');
    }

    // Get original image info
    const image = containerInfo.image;
    const imageData = await dockerApiGet(`/images/${encodeURIComponent(image)}/json`);

    if (imageData.message) {
      throw new Error(`Image inspection failed: ${imageData.message}`);
    }

    // Extract original entrypoint, cmd, and workdir from image
    const originalEntrypoint = imageData.Config?.Entrypoint || [];
    const originalCmd = imageData.Config?.Cmd || [];
    const originalWorkdir = imageData.Config?.WorkingDir || '';

    // Format as bash-consumable env vars (matching .container-info format)
    const entrypointStr = originalEntrypoint.join(' ');
    const cmdStr = originalCmd.join(' ');
    const currentEntrypointStr = (containerInfo.entrypoint || []).join(' ');
    const currentArgsStr = (containerInfo.args || []).join(' ');
    const currentCmdStr = (containerInfo.cmd || []).join(' ');

    // Format labels with LABEL_ prefix
    const labelLines = Object.entries(containerInfo.labels).map(
      ([key, value]) => `LABEL_${key.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase()}="${String(value).replace(/"/g, '\\"')}"`,
    );

    const lines = [
      '#!/bin/sh',
      '# Container reflection - auto-generated',
      `# Updated: ${new Date().toISOString()}`,
      '',
      `CONTAINER_ID="${containerInfo.id}"`,
      `CONTAINER_NAME="${containerInfo.name}"`,
      `CONTAINER_IP="${containerInfo.ipAddress}"`,
      '',
      `ORIGINAL_ENTRYPOINT="${entrypointStr.replace(/"/g, '\\"')}"`,
      `ORIGINAL_CMD="${cmdStr.replace(/"/g, '\\"')}"`,
      `ORIGINAL_IMAGE="${image.replace(/"/g, '\\"')}"`,
      `ORIGINAL_WORKDIR="${originalWorkdir}"`,
      '',
      `CURRENT_ENTRYPOINT="${currentEntrypointStr.replace(/"/g, '\\"')}"`,
      `CURRENT_ARGS="${currentArgsStr.replace(/"/g, '\\"')}"`,
      `CURRENT_CMD="${currentCmdStr.replace(/"/g, '\\"')}"`,
      '',
      '# Container Labels',
      ...labelLines,
      '',
    ];

    res.type('text/plain').send(lines.join('\n'));
  } catch (err: any) {
    console.error('Error generating reflection:', err.message);
    res.status(500).send('# Error generating reflection');
  }
});

/**
 * GET / - List available secrets based on container labels
 * Returns plaintext newline-delimited list of secrets available to this container
 * Format: /path/to/secret|http://url/to/fetch
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const containerInfo = req.containerInfo;
    if (!containerInfo) {
      return res.status(400).send('Container info not found');
    }

    const labels = containerInfo.labels;
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    // Parse labels to find all services with mount rules (dss.<service>.mount.*)
    const labelPrefix = 'dss.';
    const mountSuffix = '.mount.';
    const serviceRules = new Map<string, Array<{ secretName: string | '*'; mountPath: string }>>();

    for (const [key, value] of Object.entries(labels)) {
      if (key.startsWith(labelPrefix) && key.includes(mountSuffix)) {
        // Extract service name: dss.<service>.mount.<secret> -> <service>
        const afterPrefix = key.substring(labelPrefix.length);
        const mountIndex = afterPrefix.indexOf(mountSuffix);
        if (mountIndex > 0) {
          const serviceName = afterPrefix.substring(0, mountIndex);
          const secretName = afterPrefix.substring(mountIndex + mountSuffix.length);

          if (!serviceRules.has(serviceName)) {
            serviceRules.set(serviceName, []);
          }
          serviceRules.get(serviceName)!.push({ secretName, mountPath: value });
        }
      }
    }

    if (serviceRules.size === 0) {
      return res.type('text/plain').send('# No mount labels found for this container\n');
    }

    // Get all available services
    const allServices = await buildServicesTree();

    const lines: string[] = [];

    // Process each service found in labels
    for (const [serviceName, mountRules] of serviceRules) {
      const service = allServices.find(s => s.name === serviceName);

      if (!service || service.secrets.length === 0) {
        lines.push(`# Warning: Service '${serviceName}' not found or has no secrets`);
        continue;
      }

      for (const rule of mountRules) {
        if (rule.secretName === '*') {
          // Mount all secrets to the specified directory
          const dirPath = rule.mountPath.endsWith('/') ? rule.mountPath : `${rule.mountPath}/`;

          for (const secret of service.secrets) {
            const filePath = `${dirPath}${secret.name}`;
            const url = `${baseUrl}/api/services/${serviceName}/${secret.name}`;
            lines.push(`${filePath}|${url}`);
          }
        } else {
          // Mount specific secret to specified path
          const secret = service.secrets.find(s => s.name === rule.secretName);
          if (secret) {
            const filePath = rule.mountPath;
            const url = `${baseUrl}/api/services/${serviceName}/${secret.name}`;
            lines.push(`${filePath}|${url}`);
          } else {
            lines.push(`# Warning: Secret '${rule.secretName}' not found in service '${serviceName}'`);
          }
        }
      }
    }

    res.type('text/plain').send(lines.join('\n') + '\n');
  } catch (err: any) {
    console.error('Error generating secret list:', err.message);
    res.status(500).send('Error generating secret list');
  }
});

/**
 * GET /:serviceName/:secretName - Fetch a specific secret
 * Returns the plaintext secret value if the container has permission
 */
router.get('/:serviceName/:secretName', async (req: Request, res: Response) => {
  try {
    const containerInfo = req.containerInfo;
    if (!containerInfo) {
      return res.status(403).send('Forbidden: Container not authenticated');
    }

    const { serviceName, secretName } = req.params;
    const labels = containerInfo.labels;

    // Check if container has permission via labels
    const labelPrefix = 'dss.';
    const mountSuffix = '.mount.';
    let hasPermission = false;

    for (const [key, value] of Object.entries(labels)) {
      if (key.startsWith(labelPrefix) && key.includes(mountSuffix)) {
        // Extract service name from label
        const afterPrefix = key.substring(labelPrefix.length);
        const mountIndex = afterPrefix.indexOf(mountSuffix);
        if (mountIndex > 0) {
          const labelServiceName = afterPrefix.substring(0, mountIndex);
          const labelSecretName = afterPrefix.substring(mountIndex + mountSuffix.length);

          // Check if this label grants access to the requested secret
          if (labelServiceName === serviceName && (labelSecretName === secretName || labelSecretName === '*')) {
            hasPermission = true;
            break;
          }
        }
      }
    }

    if (!hasPermission) {
      return res.status(403).send('Forbidden: Container does not have permission to access this secret');
    }

    // Read the decrypted secret from CONTAINER_SECRETS_PATH
    const secretPath = path.join(CONTAINER_SECRETS_PATH, serviceName, secretName);

    try {
      const secretContent = await fs.readFile(secretPath, 'utf-8');
      res.type('text/plain').send(secretContent);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return res.status(404).send('Secret not found or not deployed');
      }
      throw err;
    }
  } catch (err: any) {
    console.error('Error fetching secret:', err.message);
    res.status(500).send('Error fetching secret');
  }
});

export default router;
