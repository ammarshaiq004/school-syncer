/** Where uploaded files live. Picked by STORAGE_DRIVER (see storage.provider.ts). */
export interface StorageDriver {
  readonly name: 'local' | 's3';
  /** Stores the file at `sourcePath` (a temp upload) under `key`. */
  put(key: string, sourcePath: string, mimeType: string): Promise<void>;
  /** Removes the object; missing objects are not an error. */
  delete(key: string): Promise<void>;
  /** A URL the browser can open without the API token, valid for `expiresIn` seconds. */
  signedUrl(
    key: string,
    file: { id: string; mimeType: string; disposition: string },
    expiresIn: number,
  ): Promise<string>;
}

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');
