import { assertLocalDatabase, parseCsv } from './redate.js';

describe('assertLocalDatabase', () => {
  it('accepts local hosts', () => {
    for (const host of ['localhost', '127.0.0.1', 'postgres', 'host.docker.internal']) {
      expect(() => assertLocalDatabase(`postgresql://u:p@${host}:5432/db`, 'development')).not.toThrow();
    }
  });
  it('refuses a remote host, production and a missing URL', () => {
    expect(() => assertLocalDatabase('postgresql://u:p@db.example.com:5432/db', 'development')).toThrow(/not local/);
    expect(() => assertLocalDatabase('postgresql://u:p@localhost/db', 'production')).toThrow(/production/);
    expect(() => assertLocalDatabase(undefined)).toThrow(/not set/);
  });
});

describe('parseCsv', () => {
  it('reads a header, quoted commas and blank cells', () => {
    expect(parseCsv('﻿AdmissionNo,Name,LeftDate\r\n101,"Khan, Ali",\n102,Sara,2025-03-31\n')).toEqual([
      { admissionno: '101', name: 'Khan, Ali', leftdate: '' },
      { admissionno: '102', name: 'Sara', leftdate: '2025-03-31' },
    ]);
  });
  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
