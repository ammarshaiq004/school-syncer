import { createReadStream } from 'node:fs';
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageDriver } from './storage-driver.js';

export interface S3Settings {
  bucket: string;
  region: string;
  /** For S3-compatible services (Cloudflare R2, Wasabi, MinIO, DigitalOcean Spaces). */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Path-style URLs (bucket in the path), which MinIO needs. */
  forcePathStyle: boolean;
}

/** Any S3-compatible bucket. Downloads are short-lived presigned GET URLs. */
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;
  private readonly client: S3Client;

  constructor(private readonly settings: S3Settings) {
    this.client = new S3Client({
      region: settings.region,
      endpoint: settings.endpoint || undefined,
      forcePathStyle: settings.forcePathStyle,
      credentials:
        settings.accessKeyId && settings.secretAccessKey
          ? { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey }
          : undefined,
    });
  }

  async put(key: string, sourcePath: string, mimeType: string) {
    // Multipart upload, so large lesson videos stream instead of loading into memory.
    await new Upload({
      client: this.client,
      params: { Bucket: this.settings.bucket, Key: key, Body: createReadStream(sourcePath), ContentType: mimeType },
    }).done();
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.settings.bucket, Key: key }));
  }

  signedUrl(key: string, file: { mimeType: string; disposition: string }, expiresIn: number) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.settings.bucket,
        Key: key,
        ResponseContentType: file.mimeType,
        ResponseContentDisposition: file.disposition,
      }),
      { expiresIn },
    );
  }
}
