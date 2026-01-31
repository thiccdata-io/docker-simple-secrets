import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PASSWORD_VALIDATION_FILE } from './config';

const execAsync = promisify(exec);

export async function withPassphraseFile<T>(password: string, callback: (passphraseFile: string) => Promise<T>): Promise<T> {
  const passphraseFile = path.join(os.tmpdir(), `gpg-pass-${crypto.randomBytes(16).toString('hex')}`);
  try {
    await fs.writeFile(passphraseFile, password, { mode: 0o600 });
    return await callback(passphraseFile);
  } finally {
    try {
      await fs.unlink(passphraseFile);
    } catch (err) {
      console.error('Failed to cleanup passphrase file:', err);
    }
  }
}

export async function validatePassword(password: string): Promise<{ success: boolean; message: string }> {
  try {
    await fs.access(PASSWORD_VALIDATION_FILE);

    const { stdout } = await withPassphraseFile(password, async passphraseFile => {
      return await execAsync(`gpg --batch --yes --passphrase-file ${passphraseFile} --decrypt ${PASSWORD_VALIDATION_FILE}`);
    });

    if (stdout.trim() === 'VALID_PASSWORD') {
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

    await withPassphraseFile(password, async passphraseFile => {
      await execAsync(
        `echo "VALID_PASSWORD" | gpg --batch --yes --passphrase-file ${passphraseFile} -c --cipher-algo AES256 > ${PASSWORD_VALIDATION_FILE}`,
      );
    });

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
