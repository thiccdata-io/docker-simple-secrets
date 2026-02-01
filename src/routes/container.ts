import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const router = Router();

// Store discovered Docker network CIDRs at startup
const dockerNetworkCIDRs: string[] = [];

// Discover Docker network CIDRs on startup
async function discoverDockerNetworks(): Promise<void> {
  try {
    // Get the current container's hostname
    const hostname = require('os').hostname();

    // Query container info to get network settings
    const { stdout } = await execAsync(`curl -s --unix-socket /var/run/docker.sock "http://localhost/containers/${hostname}/json"`);

    const containerData = JSON.parse(stdout);

    if (containerData.NetworkSettings && containerData.NetworkSettings.Networks) {
      const networkNames = Object.keys(containerData.NetworkSettings.Networks);

      // Query each network for its CIDR
      for (const networkName of networkNames) {
        try {
          const { stdout: netStdout } = await execAsync(
            `curl -s --unix-socket /var/run/docker.sock "http://localhost/networks/${encodeURIComponent(networkName)}"`,
          );

          const networkData = JSON.parse(netStdout);

          if (networkData.IPAM && networkData.IPAM.Config) {
            for (const config of networkData.IPAM.Config) {
              if (config.Subnet) {
                dockerNetworkCIDRs.push(config.Subnet);
                console.log(`Discovered Docker network CIDR: ${config.Subnet}`);
              }
            }
          }
        } catch (err) {
          console.warn(`Failed to inspect network ${networkName}:`, err);
        }
      }
    }
  } catch (err) {
    console.warn('Failed to discover Docker networks, using fallback ranges:', err);
  }
}

// Call discovery on module load
discoverDockerNetworks();

// Helper to check if IP is within a CIDR range
function ipInCIDR(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits)) - 1);

  const ipParts = ip.split('.').map(Number);
  const rangeParts = range.split('.').map(Number);

  const ipNum = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];
  const rangeNum = (rangeParts[0] << 24) + (rangeParts[1] << 16) + (rangeParts[2] << 8) + rangeParts[3];

  return (ipNum & mask) === (rangeNum & mask);
}

// Helper to check if request is from local/Docker network
function isLocalOrDockerNetwork(ip: string): boolean {
  // Remove IPv6 prefix if present
  const cleanIp = ip.replace(/^::ffff:/, '');

  // Localhost/loopback
  if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp === 'localhost') {
    return true;
  }

  // Check against discovered Docker network CIDRs
  if (dockerNetworkCIDRs.length > 0) {
    for (const cidr of dockerNetworkCIDRs) {
      if (ipInCIDR(cleanIp, cidr)) {
        return true;
      }
    }
  }

  // Fallback: Private IPv4 ranges if discovery failed
  const privateRanges = [
    /^10\./, // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
    /^192\.168\./, // 192.168.0.0/16
  ];

  return privateRanges.some(range => range.test(cleanIp));
}

// Endpoint to get container entrypoint and command info
router.get('/api/container/:containerName/info', async (req: Request, res: Response) => {
  const clientIp = (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');

  // Security: Only allow requests from local/Docker networks
  if (!isLocalOrDockerNetwork(clientIp)) {
    console.warn(`Blocked container info request from non-local IP: ${clientIp}`);
    return res.status(403).json({ error: 'Access denied: endpoint only accessible from local network' });
  }

  const { containerName } = req.params;

  if (!containerName) {
    return res.status(400).json({ error: 'Container name required' });
  }

  try {
    // Query Docker API via Unix socket using curl
    // Escape container name to prevent command injection
    const escapedName = containerName.replace(/[^a-zA-Z0-9_.-]/g, '');

    // Use curl to query the Docker socket directly
    const { stdout, stderr } = await execAsync(
      `curl -s --unix-socket /var/run/docker.sock "http://localhost/containers/${escapedName}/json"`,
    );

    if (stderr) {
      console.error('curl stderr:', stderr);
    }

    const containerData = JSON.parse(stdout);

    // Check if we got an error response
    if (containerData.message) {
      throw new Error(containerData.message);
    }

    // Extract the image reference from container
    const config = containerData.Config || {};
    const image = config.Image || '';

    if (!image) {
      return res.status(400).json({ error: 'Container has no image reference' });
    }

    // Always query the image for the original entrypoint/cmd (source of truth)
    const { stdout: imageStdout } = await execAsync(
      `curl -s --unix-socket /var/run/docker.sock "http://localhost/images/${encodeURIComponent(image)}/json"`,
    );

    const imageData = JSON.parse(imageStdout);

    if (imageData.message) {
      throw new Error(`Image inspection failed: ${imageData.message}`);
    }

    // Use image's entrypoint and cmd as source of truth
    const imageConfig = imageData.Config || {};
    const entrypoint = imageConfig.Entrypoint || [];
    const cmd = imageConfig.Cmd || [];

    return res.json({
      container: containerName,
      entrypoint: entrypoint,
      cmd: cmd,
      image: image,
      workingDir: imageConfig.WorkingDir || null,
    });
  } catch (err: any) {
    console.error(`Failed to inspect container ${containerName}:`, err.message);

    if (err.message.includes('No such object') || err.message.includes('no such container')) {
      return res.status(404).json({ error: `Container not found: ${containerName}` });
    }

    return res.status(500).json({ error: 'Failed to inspect container', details: err.message });
  }
});

export default router;
