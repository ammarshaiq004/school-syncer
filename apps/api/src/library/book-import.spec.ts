import { bookRowSchema, checkBookRows, isbnKey, titleKey } from './book-import.js';

const row = (r: Record<string, string | number>) => bookRowSchema.parse(r);
const none = { isbns: new Set<string>(), titles: new Set<string>() };

describe('checkBookRows', () => {
  it('accepts a minimal row and defaults language and copies', () => {
    const [r] = checkBookRows([row({ title: 'Urdu Qaida' })], none);
    expect(r.errors).toEqual([]);
    expect(r.book).toMatchObject({ title: 'Urdu Qaida', language: 'English', copies: 1, isbn: null });
  });

  it('reports a missing title, a bad ISBN and a bad copy count with the sheet row number', () => {
    const rows = checkBookRows(
      [row({ title: '', isbn: '123' }), row({ title: 'A', copies: '0' }), row({ title: 'B', copies: 2.5 })],
      none,
    );
    expect(rows[0]).toMatchObject({ row: 2, errors: ['Title is missing', 'ISBN "123" should have 10 or 13 digits'] });
    expect(rows[1].errors[0]).toMatch(/Copies "0"/);
    expect(rows[2].errors[0]).toMatch(/Copies "2.5"/);
    expect(rows.every((r) => !r.book)).toBe(true);
  });

  it('normalises ISBNs and flags one repeated in the file', () => {
    const rows = checkBookRows([row({ title: 'A', isbn: '978-969-8123-45-6' }), row({ title: 'B', isbn: '9789698123456' })], none);
    expect(rows[0].book?.isbn).toBe('9789698123456');
    expect(rows[1].errors[0]).toBe('ISBN 9789698123456 is also on row 2');
    expect(isbnKey('0-306-40615-x')).toBe('030640615X');
  });

  it('warns when the title or ISBN is already catalogued', () => {
    const existing = { isbns: new Set(['9789698123456']), titles: new Set([titleKey('Gulistan', 'Saadi')]) };
    const rows = checkBookRows([row({ title: 'X', isbn: '9789698123456' }), row({ title: ' gulistan ', author: 'SAADI' })], existing);
    expect(rows[0].warnings).toHaveLength(1);
    expect(rows[1].warnings).toHaveLength(1);
    expect(rows.every((r) => r.book)).toBe(true);
  });

  it('rejects over-long fields', () => {
    const [r] = checkBookRows([row({ title: 'T', shelf: 'x'.repeat(21) })], none);
    expect(r.errors).toEqual(['Shelf is too long']);
  });
});
