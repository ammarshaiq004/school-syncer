// A school library's catalogue and a year of borrowing.
import {
  CopyStatus,
  FineStatus,
  PrismaClient,
  type Prisma,
} from '@prisma/client';
import { daysBefore } from '../../src/common/dates.js';
import { dueDate, lateFine } from '../../src/library/library-rules.js';
import type { Random } from './random.js';

type Title = [
  title: string,
  author: string | null,
  category: string,
  language?: string,
];

export const BOOKS: Title[] = [
  ['The Jungle Book', 'Rudyard Kipling', 'Fiction'],
  ['Alice in Wonderland', 'Lewis Carroll', 'Fiction'],
  ['Treasure Island', 'Robert Louis Stevenson', 'Fiction'],
  ['Black Beauty', 'Anna Sewell', 'Fiction'],
  ['Heidi', 'Johanna Spyri', 'Fiction'],
  ['The Secret Garden', 'Frances Hodgson Burnett', 'Fiction'],
  ['Little Women', 'Louisa May Alcott', 'Fiction'],
  ['Charlotte’s Web', 'E. B. White', 'Fiction'],
  ['Matilda', 'Roald Dahl', 'Fiction'],
  ['Charlie and the Chocolate Factory', 'Roald Dahl', 'Fiction'],
  ['The BFG', 'Roald Dahl', 'Fiction'],
  ['The Famous Five: Five on a Treasure Island', 'Enid Blyton', 'Fiction'],
  ['The Secret Seven', 'Enid Blyton', 'Fiction'],
  ['Malory Towers', 'Enid Blyton', 'Fiction'],
  ['The Adventures of Tom Sawyer', 'Mark Twain', 'Fiction'],
  ['Robinson Crusoe', 'Daniel Defoe', 'Fiction'],
  ['Gulliver’s Travels', 'Jonathan Swift', 'Fiction'],
  ['Around the World in Eighty Days', 'Jules Verne', 'Fiction'],
  ['The Wind in the Willows', 'Kenneth Grahame', 'Fiction'],
  ['Pinocchio', 'Carlo Collodi', 'Fiction'],
  ['The Little Prince', 'Antoine de Saint-Exupéry', 'Fiction'],
  ['Wonder', 'R. J. Palacio', 'Fiction'],
  ['Diary of a Wimpy Kid', 'Jeff Kinney', 'Fiction'],
  ['Harry Potter and the Philosopher’s Stone', 'J. K. Rowling', 'Fiction'],
  ['Percy Jackson and the Lightning Thief', 'Rick Riordan', 'Fiction'],
  ['Amelia Earhart', 'Little People, Big Dreams', 'Biography'],
  ['I Am Malala (Young Readers Edition)', 'Malala Yousafzai', 'Biography'],
  ['Quaid-e-Azam Muhammad Ali Jinnah', 'Ferozsons', 'Biography'],
  ['Allama Iqbal: The Poet of the East', 'Ferozsons', 'Biography'],
  ['Abdul Sattar Edhi: A Mirror to the Blind', 'Tehmina Durrani', 'Biography'],
  ['Stories of the Prophets', 'Ibn Kathir', 'Islamic studies'],
  ['Seerat-un-Nabi for Children', 'Darussalam', 'Islamic studies'],
  ['Tales from the Quran', 'Saniyasnain Khan', 'Islamic studies'],
  ['The Hundred Great Muslims', 'Jamil Ahmad', 'Islamic studies'],
  ['Oxford School Atlas for Pakistan', 'Oxford University Press', 'Reference'],
  ['Oxford Children’s Dictionary', 'Oxford University Press', 'Reference'],
  ['Ferozsons Urdu Dictionary', 'Ferozsons', 'Reference', 'Urdu'],
  ['Children’s Encyclopedia', 'DK', 'Reference'],
  ['The Human Body', 'DK Eyewitness', 'Science'],
  ['Space: A Visual Encyclopedia', 'DK', 'Science'],
  ['Dinosaurs', 'DK Eyewitness', 'Science'],
  ['Electricity and Magnetism', 'Usborne', 'Science'],
  ['100 Science Experiments', 'Usborne', 'Science'],
  ['How Things Work', 'National Geographic Kids', 'Science'],
  ['The Story of Pakistan', 'M. R. Kazimi', 'History'],
  ['Mughal Emperors of India', 'Usborne', 'History'],
  ['Ancient Egypt', 'DK Eyewitness', 'History'],
  ['Murder on the Orient Express', 'Agatha Christie', 'Fiction'],
  ['The Hound of the Baskervilles', 'Arthur Conan Doyle', 'Fiction'],
  ['Animal Farm', 'George Orwell', 'Fiction'],
  ['Umro Ayyar ki Kahaniyan', 'Maqbool Jahangir', 'Fiction', 'Urdu'],
  ['Ainak Wala Jin', 'A. Hameed', 'Fiction', 'Urdu'],
  ['Taleem-o-Tarbiat ki Kahaniyan', 'Ferozsons', 'Fiction', 'Urdu'],
  ['Bachon ki Kahaniyan', 'Ishtiaq Ahmed', 'Fiction', 'Urdu'],
  ['Inspector Jamshed Series', 'Ishtiaq Ahmed', 'Fiction', 'Urdu'],
  ['Chacha Chakkan', 'Imtiaz Ali Taj', 'Fiction', 'Urdu'],
  ['Bang-e-Dra', 'Allama Muhammad Iqbal', 'Poetry', 'Urdu'],
  ['Bal-e-Jibril', 'Allama Muhammad Iqbal', 'Poetry', 'Urdu'],
  ['Bachon ki Nazmein', 'Sufi Tabassum', 'Poetry', 'Urdu'],
  ['A Child’s Garden of Verses', 'Robert Louis Stevenson', 'Poetry'],
  ['Grammar in Use for Young Learners', 'Cambridge', 'English'],
  ['Wren and Martin: English Grammar', 'P. C. Wren', 'English'],
  ['Mental Maths', 'Oxford University Press', 'Mathematics'],
  ['Maths Puzzles for Clever Kids', 'Gareth Moore', 'Mathematics'],
  ['Computer Science for Kids', 'Oxford University Press', 'Computers'],
  ['Scratch Programming Playground', 'Al Sweigart', 'Computers'],
  ['Pakistan Studies Guide', 'Gaba', 'Pakistan studies'],
  ['Our Beautiful Pakistan', 'Ferozsons', 'Pakistan studies'],
];

export interface Reader {
  id: string;
  level: number;
  ability: number;
}

/** A catalogue with a year of borrowing; books out now, a few overdue and some unpaid fines. */
export async function seedLibrary(
  prisma: PrismaClient,
  rng: Random,
  schoolId: string,
  readers: Reader[],
  staffIds: string[],
  yearStart: string,
  today: string,
  settings: { loanDays: number; finePerDay: number },
) {
  let accession = 0;
  const copies: { id: string; title: string; level: number }[] = [];
  for (const [i, [title, author, category, language]] of BOOKS.entries()) {
    const book = await prisma.book.create({
      data: {
        schoolId,
        title,
        author,
        category,
        language: language ?? 'English',
        shelf: `${String.fromCharCode(65 + (i % 6))}-${1 + (Math.floor(i / 6) % 5)}`,
      },
    });
    const n = category === 'Reference' ? 1 : rng.int(1, 4);
    const rows = await prisma.bookCopy.createManyAndReturn({
      data: Array.from({ length: n }, () => ({
        schoolId,
        bookId: book.id,
        accessionNo: String(++accession),
      })),
    });
    // Picture books and Urdu stories suit younger readers; novels older ones.
    const level =
      ['Reference', 'Poetry'].includes(category) || language
        ? 3
        : rng.int(1, 8);
    for (const r of rows) copies.push({ id: r.id, title, level });
  }

  // Keen readers borrow every few weeks; one at a time, so no copy is lent twice at once.
  const busyUntil = new Map<string, string>();
  const loans: Prisma.BookLoanCreateManyInput[] = [];
  const keen = readers.filter(
    (r) => r.level >= 1 && rng.chance(0.25 + r.ability * 0.4),
  );
  const lent = new Set<string>();
  for (const reader of keen) {
    let day = daysBefore(yearStart, -rng.int(5, 40));
    while (day < today) {
      const fits = copies.filter(
        (c) =>
          Math.abs(c.level - reader.level) <= 3 &&
          (busyUntil.get(c.id) ?? '') < day,
      );
      if (!fits.length) break;
      const copy = rng.pick(fits);
      const due = dueDate(day, settings.loanDays);
      const keptDays = rng.chance(0.15)
        ? settings.loanDays + rng.int(1, 12)
        : rng.int(4, settings.loanDays);
      const back = daysBefore(day, -keptDays);
      const stillOut = back >= today;
      const fine = stillOut ? 0 : lateFine(due, back, settings.finePerDay);
      loans.push({
        schoolId,
        copyId: copy.id,
        studentId: reader.id,
        issuedOn: new Date(`${day}T00:00:00Z`),
        dueOn: new Date(`${due}T00:00:00Z`),
        returnedOn: stillOut ? null : new Date(`${back}T00:00:00Z`),
        fine,
        // Older fines were paid at the desk; this month's are still owed.
        fineStatus: !fine
          ? FineStatus.NONE
          : back >= daysBefore(today, 20)
            ? FineStatus.DUE
            : FineStatus.PAID,
      });
      busyUntil.set(copy.id, stillOut ? '9999-12-31' : back);
      if (stillOut) lent.add(copy.id);
      day = daysBefore(back, -rng.int(7, 45));
      if (stillOut) break;
    }
  }
  // A few teachers have reference books out.
  for (const staffId of staffIds.slice(0, 4)) {
    const free = copies.filter((c) => !lent.has(c.id));
    const copy = rng.pick(free);
    const issued = daysBefore(today, rng.int(3, 25));
    loans.push({
      schoolId,
      copyId: copy.id,
      userId: staffId,
      issuedOn: new Date(`${issued}T00:00:00Z`),
      dueOn: new Date(`${dueDate(issued, 30)}T00:00:00Z`),
    });
    lent.add(copy.id);
  }
  await prisma.bookLoan.createMany({ data: loans });
  await prisma.bookCopy.updateMany({
    where: { id: { in: [...lent] } },
    data: { status: CopyStatus.ON_LOAN },
  });
  // Two copies went missing over the year.
  const missing = rng
    .shuffle(copies.filter((c) => !lent.has(c.id)))
    .slice(0, 2);
  await prisma.bookCopy.updateMany({
    where: { id: { in: missing.map((m) => m.id) } },
    data: { status: CopyStatus.WITHDRAWN },
  });
  return {
    titles: BOOKS.length,
    copies: copies.length,
    loans: loans.length,
    out: lent.size,
  };
}
