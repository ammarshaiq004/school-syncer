import {
  acceptedExtensions,
  checkFile,
  cleanFilename,
  contentDisposition,
  dispositionFor,
  formatBytes,
  storageProblem,
} from './file-rules.js';

const MB = 1024 * 1024;
const bytes = (...values: number[]) => Buffer.from(values);
const text = (s: string) => Buffer.from(s, 'latin1');
const mp4 = Buffer.concat([bytes(0, 0, 0, 0x20), text('ftypisom')]);
const pdf = text('%PDF-1.7\n');
const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0);
const docx = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0);

describe('checkFile', () => {
  it('accepts a lesson video and reports its stored type', () => {
    expect(checkFile('LESSON', 'Fractions.MP4', 40 * MB, mp4)).toEqual({
      ok: true,
      ext: 'mp4',
      kind: 'video',
      mime: 'video/mp4',
    });
  });

  it('accepts documents, images and office files for assignments', () => {
    expect(checkFile('ASSIGNMENT', 'worksheet.pdf', MB, pdf).ok).toBe(true);
    expect(checkFile('ASSIGNMENT', 'diagram.png', MB, png).ok).toBe(true);
    expect(checkFile('ASSIGNMENT', 'brief.docx', MB, docx).ok).toBe(true);
    expect(checkFile('SUBMISSION', 'notes.txt', 20, text('my answer'))).toMatchObject({ ok: true, mime: 'text/plain' });
  });

  it('refuses types that are not allowed for the purpose', () => {
    const video = checkFile('ASSIGNMENT', 'clip.mp4', MB, mp4);
    expect(video.ok).toBe(false);
    expect(checkFile('LESSON', 'site.html', 10, text('<html>')).ok).toBe(false);
    expect(checkFile('LESSON', 'logo.svg', 10, text('<svg>')).ok).toBe(false);
    expect(checkFile('SUBMISSION', 'setup.exe', 10, text('MZ')).ok).toBe(false);
    expect(checkFile('SUBMISSION', 'no-extension', 10, pdf).ok).toBe(false);
  });

  it('refuses a file whose bytes do not match its extension', () => {
    const renamed = checkFile('SUBMISSION', 'homework.pdf', 100, text('MZ\x90\x00'));
    expect(renamed).toEqual({ ok: false, problem: 'This file does not look like a real .pdf file' });
    expect(checkFile('SUBMISSION', 'notes.txt', 3, bytes(0x41, 0, 0x42)).ok).toBe(false);
  });

  it('applies the size limit of the kind and purpose', () => {
    expect(checkFile('LESSON', 'long.mp4', 500 * MB, mp4).ok).toBe(true);
    expect(checkFile('LESSON', 'huge.mp4', 501 * MB, mp4)).toEqual({
      ok: false,
      problem: 'This file is 501 MB. Videos can be up to 500 MB.',
    });
    expect(checkFile('SUBMISSION', 'clip.mp4', 101 * MB, mp4).ok).toBe(false);
    expect(checkFile('LESSON', 'empty.pdf', 0, pdf)).toEqual({ ok: false, problem: 'The file is empty' });
  });
});

describe('file names and headers', () => {
  it('drops folders, control characters and quotes', () => {
    expect(cleanFilename('C:\\Users\\ali\\Unit 1 "final".pdf')).toBe('Unit 1 final.pdf');
    expect(cleanFilename('../../etc/passwd')).toBe('passwd');
    expect(cleanFilename('...')).toBe('file');
    expect(cleanFilename(`${'a'.repeat(300)}.docx`)).toMatch(/^a{155}\.docx$/);
  });

  it('shows media and PDF inline and downloads the rest', () => {
    expect(dispositionFor('video/mp4')).toBe('inline');
    expect(dispositionFor('application/pdf')).toBe('inline');
    expect(dispositionFor('text/plain')).toBe('attachment');
    expect(dispositionFor('application/zip')).toBe('attachment');
    expect(contentDisposition('application/zip', 'کام.zip')).toBe(
      `attachment; filename="___.zip"; filename*=UTF-8''${encodeURIComponent('کام.zip')}`,
    );
  });

  it('lists accepted extensions per purpose', () => {
    expect(acceptedExtensions('LESSON')).toContain('mp4');
    expect(acceptedExtensions('ASSIGNMENT')).not.toContain('mp4');
    expect(acceptedExtensions('SUBMISSION')).toContain('zip');
  });
});

describe('storageProblem', () => {
  it('allows uploads within the plan and refuses beyond it', () => {
    expect(storageProblem(4 * 1024 * MB, 500 * MB, 5120)).toBeNull();
    expect(storageProblem(4.9 * 1024 * MB, 500 * MB, 5120)).toBe(
      'The school has used 4.9 GB of its 5 GB file storage. Delete old files or upgrade the plan to upload this.',
    );
    expect(storageProblem(10 ** 12, MB, null)).toBeNull();
  });

  it('formats sizes for people', () => {
    expect(formatBytes(512)).toBe('1 KB');
    expect(formatBytes(3 * MB)).toBe('3 MB');
    expect(formatBytes(1536 * MB)).toBe('1.5 GB');
  });
});
