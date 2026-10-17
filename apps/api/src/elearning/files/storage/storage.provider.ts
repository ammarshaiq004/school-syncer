import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fileSigningSecrets } from '../../../common/signing-secrets.js';
import { LocalStorageDriver } from './local.driver.js';
import { S3StorageDriver } from './s3.driver.js';
import { STORAGE_DRIVER, type StorageDriver } from './storage-driver.js';

/**
 * STORAGE_DRIVER=s3 uses S3_BUCKET (+ S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY_ID,
 * S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE). Anything else, including unset,
 * stores files under STORAGE_LOCAL_DIR (default ./uploads).
 */
export function createStorageDriver(config: ConfigService): StorageDriver {
  if (config.get('STORAGE_DRIVER') === 's3') {
    return new S3StorageDriver({
      bucket: config.getOrThrow<string>('S3_BUCKET'),
      region: config.get<string>('S3_REGION') || 'auto',
      endpoint: config.get<string>('S3_ENDPOINT'),
      accessKeyId: config.get<string>('S3_ACCESS_KEY_ID'),
      secretAccessKey: config.get<string>('S3_SECRET_ACCESS_KEY'),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE') === 'true',
    });
  }
  const port = config.get<string>('PORT') || '4000';
  const publicUrl = (config.get<string>('API_PUBLIC_URL') || `http://localhost:${port}`).replace(/\/+$/, '');
  const signing = fileSigningSecrets(signingEnv(config));
  return new LocalStorageDriver(config.get<string>('STORAGE_LOCAL_DIR') || 'uploads', signing.current, publicUrl, signing.previous);
}

/** The settings fileSigningSecrets reads, from the config (which includes .env). */
export const signingEnv = (config: ConfigService) =>
  Object.fromEntries(
    ['FILE_SIGNING_SECRET', 'FILE_SIGNING_SECRET_PREVIOUS', 'JWT_SECRET', 'JWT_SECRET_PREVIOUS'].map((k) => [k, config.get<string>(k)]),
  );

export const storageProvider: Provider = {
  provide: STORAGE_DRIVER,
  inject: [ConfigService],
  useFactory: createStorageDriver,
};
