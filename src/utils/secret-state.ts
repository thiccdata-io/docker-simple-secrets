import fs from 'fs/promises';
import path from 'path';
import { SECRETS_STORE_PATH } from './config';
import { SecretState } from './types';

/**
 * Get the path to a secret's state file
 */
export function getSecretStatePath(serviceName: string, secretName: string): string {
  return path.join(SECRETS_STORE_PATH, serviceName, `${secretName}.state`);
}

/**
 * Read the state of a secret
 */
export async function readSecretState(serviceName: string, secretName: string): Promise<SecretState> {
  try {
    const statePath = getSecretStatePath(serviceName, secretName);
    const content = await fs.readFile(statePath, 'utf-8');
    return JSON.parse(content);
  } catch (error: any) {
    // If state file doesn't exist, return default
    if (error.code === 'ENOENT') {
      return { mounted: false };
    }
    throw error;
  }
}

/**
 * Write the state of a secret
 */
export async function writeSecretState(serviceName: string, secretName: string, state: SecretState): Promise<void> {
  const statePath = getSecretStatePath(serviceName, secretName);
  await fs.writeFile(statePath, JSON.stringify(state, null, 2));
}

/**
 * Create default state file for a new secret
 */
export async function createDefaultState(serviceName: string, secretName: string): Promise<void> {
  const state: SecretState = { mounted: false };
  await writeSecretState(serviceName, secretName, state);
}

/**
 * Toggle the mounted state of a secret
 */
export async function toggleSecretMounted(serviceName: string, secretName: string): Promise<boolean> {
  const currentState = await readSecretState(serviceName, secretName);
  const newState: SecretState = { mounted: !currentState.mounted };
  await writeSecretState(serviceName, secretName, newState);
  return newState.mounted;
}
