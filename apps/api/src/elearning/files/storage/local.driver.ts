import { createHmac, timingSafeEqual } from 'node:crypto';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { StorageDriver } from './storage-driver.js';

/**
 * Files on the API server's disk, for development, tests and single-server
 * installs. Downloads go through GET /api/files/:id/content with an HMAC
 * signature and expiry in the query string, so <video> tags can play them.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;
  private readonly root: string;

  constructor(
    root: string,
    private readonly secret: string,
    private readonly publicApiUrl: string,
  ) {
    this.root = resolve(root);
  }

  /** Absolute path of a key, refusing anything that escapes the root. */
  pathOf(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return path;
  }

  async put(key: string, sourcePath: string) {
    const target = this.pathOf(key);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(sourcePath, target);
  }

  async delete(key: string) {
    await rm(this.pathOf(key), { force: true });
  }

  async signedUrl(_key: string, file: { id: string }, expiresIn: number) {
    const exp = Math.floor(Date.now() / 1000) + expiresIn;
    const sig = this.sign(file.id, exp);
    return `${this.publicApiUrl}/api/files/${encodeURIComponent(file.id)}/content?exp=${exp}&sig=${sig}`;
  }

  /** True when the signature matches the file and has not expired. */
  verify(fileId: string, exp: string | undefined, sig: string | undefined): boolean {
    if (!exp || !sig || !/^\d+$/.test(exp)) return false;
    if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
    const expected = Buffer.from(this.sign(fileId, Number(exp)));
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private sign(fileId: string, exp: number) {
    return createHmac('sha256', this.secret).update(`file:${fileId}:${exp}`).digest('base64url');
  }
}
