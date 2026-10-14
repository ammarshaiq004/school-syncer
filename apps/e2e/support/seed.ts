import { readFileSync } from 'node:fs';
import { SEED_FILE } from './env';

/** What the setup project created; the tests read it to sign in and find their data. */
export interface Seed {
  run: string;
  /** Every school the run created, for cleanup. */
  slugs: string[];
  consoleAdmin: { id: string; email: string; password: string };
  /** Registered by its owner: the school the tests work in. */
  school: { slug: string; name: string; ownerEmail: string; password: string };
  /** Set up from the console, so its owner must replace the issued password. */
  fresh: { slug: string; ownerEmail: string; temporaryPassword: string };
  teacher: { name: string; phone: string; password: string };
  parent: { name: string; phone: string; password: string };
  /** The teacher's class section (Grade 5 A) and one they don't teach (Grade 6 A). */
  sections: { taught: string; other: string };
  /** The parent's child, in Grade 6 A, with attendance and a fee voucher. */
  child: { id: string; name: string };
  /** Grade 5 A's students, for marks. */
  taughtStudents: string[];
  exam: { id: string; name: string };
  period: string;
}

export const readSeed = (): Seed => JSON.parse(readFileSync(SEED_FILE, 'utf8')) as Seed;

/** Today in the school's timezone (the API's school day), as YYYY-MM-DD. */
export const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
