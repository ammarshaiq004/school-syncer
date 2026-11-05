import { z } from 'zod';

const cell = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v == null ? '' : String(v).trim()));

/** One spreadsheet row as the web app reads it: every cell is text, so mistakes become a list to fix. */
export const bookRowSchema = z.object({
  title: cell,
  author: cell,
  isbn: cell,
  publisher: cell,
  category: cell,
  language: cell,
  shelf: cell,
  copies: cell,
});
export type BookRow = z.infer<typeof bookRowSchema>;

export interface ParsedBook {
  title: string;
  author: string | null;
  isbn: string | null;
  publisher: string | null;
  category: string | null;
  language: string;
  shelf: string | null;
  copies: number;
}

export interface CheckedBook {
  /** Spreadsheet row number, counting the header as row 1. */
  row: number;
  title: string;
  errors: string[];
  /** Worth a look but allowed (the title is already in the catalogue: its copies are added to it). */
  warnings: string[];
  book?: ParsedBook;
}

export const MAX_COPIES_PER_ROW = 200;

/** Keeps digits and a trailing X, so "978-969-0123-45" and "9789690123 45" compare equal. */
export const isbnKey = (isbn: string) => isbn.replace(/[^0-9Xx]/g, '').toUpperCase();

export const titleKey = (title: string, author: string) => `${title}|${author}`.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Checks every row of a book list. A title already in the catalogue (same
 * ISBN, or same title and author) is not duplicated: the controller adds the
 * row's copies to it.
 */
export function checkBookRows(rows: BookRow[], existing: { isbns: Set<string>; titles: Set<string> }): CheckedBook[] {
  const seenIsbn = new Map<string, number>();
  return rows.map((r, i) => {
    const row = i + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!r.title) errors.push('Title is missing');
    else if (r.title.length > 200) errors.push('Title is too long');
    for (const [label, value, max] of [
      ['Author', r.author, 120],
      ['Publisher', r.publisher, 120],
      ['Category', r.category, 60],
      ['Language', r.language, 30],
      ['Shelf', r.shelf, 20],
    ] as const) {
      if (value.length > max) errors.push(`${label} is too long`);
    }
    let isbn: string | null = null;
    if (r.isbn) {
      const key = isbnKey(r.isbn);
      if (![10, 13].includes(key.length)) errors.push(`ISBN "${r.isbn}" should have 10 or 13 digits`);
      else {
        isbn = key;
        const earlier = seenIsbn.get(key);
        if (earlier) errors.push(`ISBN ${r.isbn} is also on row ${earlier}`);
        else seenIsbn.set(key, row);
        if (existing.isbns.has(key)) warnings.push('This ISBN is already in the catalogue; the copies are added to that book');
      }
    }
    if (!isbn && r.title && existing.titles.has(titleKey(r.title, r.author))) {
      warnings.push('This title is already in the catalogue; the copies are added to that book');
    }
    let copies = 1;
    if (r.copies) {
      copies = Number(r.copies);
      if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES_PER_ROW) {
        errors.push(`Copies "${r.copies}" should be a whole number from 1 to ${MAX_COPIES_PER_ROW}`);
        copies = 1;
      }
    }
    const checked: CheckedBook = { row, title: r.title, errors, warnings };
    if (!errors.length) {
      checked.book = {
        title: r.title,
        author: r.author || null,
        isbn,
        publisher: r.publisher || null,
        category: r.category || null,
        language: r.language || 'English',
        shelf: r.shelf || null,
        copies,
      };
    }
    return checked;
  });
}
