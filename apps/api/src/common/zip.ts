import { Readable, type Writable } from 'node:stream';
import { crc32, createDeflateRaw } from 'node:zlib';

// shortcut: no ZIP64, so one file or the whole archive must stay under 4 GB; upgrade if a school's export gets near that.

interface Entry {
  name: Buffer;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
}

const DOS_DATE = (1 << 5) | 1; // 1980-01-01, so the same data always gives the same bytes
const FLAGS = 0x0808; // sizes follow the data, names are UTF-8

/** Writes a zip file to a stream one file at a time, without holding the files in memory. */
export class ZipWriter {
  private offset = 0;
  private readonly entries: Entry[] = [];

  constructor(private readonly out: Writable) {}

  /** Adds a deflated file whose content arrives in chunks. */
  async addFile(name: string, content: Iterable<string | Buffer> | AsyncIterable<string | Buffer>) {
    const entry: Entry = { name: Buffer.from(name, 'utf8'), crc: 0, compressed: 0, size: 0, offset: this.offset };
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(FLAGS, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt16LE(entry.name.length, 26);
    await this.write(Buffer.concat([header, entry.name]));

    const input = Readable.from(content, { objectMode: false });
    const deflate = createDeflateRaw();
    input.on('data', (chunk: Buffer) => {
      entry.crc = crc32(chunk, entry.crc);
      entry.size += chunk.length;
    });
    input.on('error', (e) => deflate.destroy(e));
    input.pipe(deflate);
    for await (const chunk of deflate) {
      entry.compressed += chunk.length;
      await this.write(chunk);
    }

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(entry.crc, 4);
    descriptor.writeUInt32LE(entry.compressed, 8);
    descriptor.writeUInt32LE(entry.size, 12);
    await this.write(descriptor);
    this.entries.push(entry);
  }

  /** Writes the directory that ends the zip and closes the stream. */
  async finish() {
    const start = this.offset;
    for (const e of this.entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(FLAGS, 8);
      h.writeUInt16LE(8, 10);
      h.writeUInt16LE(DOS_DATE, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.compressed, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt32LE(e.offset, 42);
      await this.write(Buffer.concat([h, e.name]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
    await new Promise<void>((resolve, reject) => {
      this.out.once('error', reject);
      this.out.end(resolve);
    });
  }

  private write(chunk: Buffer) {
    this.offset += chunk.length;
    if (this.out.write(chunk)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.out.once('drain', resolve);
      this.out.once('error', reject);
    });
  }
}
