import { Writable } from 'node:stream';
import { crc32, inflateRawSync } from 'node:zlib';
import { ZipWriter } from './zip.js';

/** Reads a zip back through its central directory, as an unzip tool would. */
function readZip(zip: Buffer) {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let pos = zip.readUInt32LE(end + 16);
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(pos)).toBe(0x02014b50);
    const crc = zip.readUInt32LE(pos + 16);
    const compressed = zip.readUInt32LE(pos + 20);
    const size = zip.readUInt32LE(pos + 24);
    const nameLen = zip.readUInt16LE(pos + 28);
    const local = zip.readUInt32LE(pos + 42);
    const name = zip.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    const data = zip.subarray(local + 30 + nameLen, local + 30 + nameLen + compressed);
    const text = inflateRawSync(data);
    expect(text.length).toBe(size);
    expect(crc32(text)).toBe(crc);
    files[name] = text.toString('utf8');
    pos += 46 + nameLen;
  }
  return files;
}

const sink = () => {
  const chunks: Buffer[] = [];
  const out = new Writable({ write: (c, _e, cb) => (chunks.push(c), cb()) });
  return { out, bytes: () => Buffer.concat(chunks) };
};

describe('ZipWriter', () => {
  it('writes files that read back whole, including empty ones and non-ASCII names', async () => {
    const { out, bytes } = sink();
    const zip = new ZipWriter(out);
    await zip.addFile('students.csv', ['id,name\n', '1,Ayesha\n', Buffer.from('2,Bilal\n')]);
    await zip.addFile('خالی.csv', []);
    await zip.addFile('big.txt', (function* () { for (let i = 0; i < 2000; i++) yield `line ${i}\n`.repeat(50); })());
    await zip.finish();
    const files = readZip(bytes());
    expect(files['students.csv']).toBe('id,name\n1,Ayesha\n2,Bilal\n');
    expect(files['خالی.csv']).toBe('');
    expect(files['big.txt'].split('\n')).toHaveLength(2000 * 50 + 1);
  });

  it('stops with the error when a source fails', async () => {
    const { out } = sink();
    const zip = new ZipWriter(out);
    async function* broken() {
      yield 'a';
      throw new Error('db down');
    }
    await expect(zip.addFile('x.csv', broken())).rejects.toThrow('db down');
  });
});
