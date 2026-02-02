import * as http from 'http';

const DOCKER_SOCK = '/var/run/docker.sock';

/**
 * Makes a GET request to the Docker API and returns parsed JSON
 */
export async function dockerApiGet(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = { socketPath: DOCKER_SOCK, path, method: 'GET' };
    http
      .get(options, res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 400) {
              return reject(new Error(`Docker API Error (${res.statusCode}): ${parsed.message || data}`));
            }
            resolve(parsed);
          } catch (err) {
            reject(new Error(`Failed to parse Docker API response: ${err}`));
          }
        });
      })
      .on('error', reject);
  });
}
