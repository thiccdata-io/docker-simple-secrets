import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { PASSWORD_VALIDATION_FILE } from './config';

// Crypto configuration
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits for GCM
const SALT_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;
const SCRYPT_N = 16384; // CPU/memory cost parameter
const SCRYPT_R = 8; // Block size parameter
const SCRYPT_P = 1; // Parallelization parameter

/**
 * Derive a key from a password using scrypt
 */
function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Encrypt data with AES-256-GCM
 * Format: [salt(32)][iv(16)][authTag(16)][encryptedData]
 */
export async function encrypt(plaintext: string, password: string): Promise<Buffer> {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = await deriveKey(password, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, authTag, encrypted]);
}

/**
 * Decrypt data encrypted with AES-256-GCM
 */
export async function decrypt(encryptedData: Buffer, password: string): Promise<string> {
  if (encryptedData.length < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted data format');
  }

  const salt = encryptedData.subarray(0, SALT_LENGTH);
  const iv = encryptedData.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = encryptedData.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = encryptedData.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = await deriveKey(password, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (error) {
    throw new Error('Decryption failed - invalid password or corrupted data');
  }
}

export async function validatePassword(password: string): Promise<{ success: boolean; message: string }> {
  try {
    const encryptedData = await fs.readFile(PASSWORD_VALIDATION_FILE);
    const decrypted = await decrypt(encryptedData, password);

    if (decrypted === 'VALID_PASSWORD') {
      return { success: true, message: 'Password validated successfully' };
    }
    return { success: false, message: 'Invalid password' };
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return { success: false, message: 'Validation file not found' };
    }
    return { success: false, message: 'Invalid password' };
  }
}

export async function createPasswordValidation(password: string): Promise<{ success: boolean; message: string }> {
  try {
    await fs.mkdir(path.dirname(PASSWORD_VALIDATION_FILE), { recursive: true });
    const encrypted = await encrypt('VALID_PASSWORD', password);
    await fs.writeFile(PASSWORD_VALIDATION_FILE, encrypted);
    return { success: true, message: 'Password validation file created successfully' };
  } catch (error: any) {
    return { success: false, message: `Failed to create validation file: ${error.message}` };
  }
}

export async function calculateMD5(filePath: string): Promise<string> {
  try {
    const fileContent = await fs.readFile(filePath);
    return crypto.createHash('md5').update(fileContent).digest('hex');
  } catch (error) {
    throw new Error(`Failed to calculate MD5: ${error}`);
  }
}

export async function encryptSecret(value: string, password: string, outputPath: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const encrypted = await encrypt(value, password);
    await fs.writeFile(outputPath, encrypted);
  } catch (error: any) {
    throw new Error(`Failed to encrypt secret: ${error.message}`);
  }
}

export async function decryptSecret(secretPath: string, password: string): Promise<string> {
  try {
    const encryptedData = await fs.readFile(secretPath);
    return await decrypt(encryptedData, password);
  } catch (error: any) {
    throw new Error(`Failed to decrypt secret: ${error.message}`);
  }
}
