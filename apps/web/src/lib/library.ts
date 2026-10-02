export interface Loan {
  id: string;
  accessionNo: string;
  bookId: string;
  title: string;
  author: string | null;
  borrower: { kind: "student" | "staff"; id: string; name: string; detail: string };
  issuedOn: string;
  dueOn: string;
  returnedOn: string | null;
  lost: boolean;
  overdue: boolean;
  fine: number | null;
  fineStatus: "NONE" | "DUE" | "PAID" | "BILLED" | "WAIVED";
}

export interface BookRow {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  publisher: string | null;
  category: string | null;
  language: string;
  shelf: string | null;
  copies: number;
  available: number;
}

export const FINE_LABEL: Record<Loan["fineStatus"], string> = {
  NONE: "",
  DUE: "fine due",
  PAID: "fine paid",
  BILLED: "on fee voucher",
  WAIVED: "fine let off",
};

/** Days a book is overdue, as of today in the browser. */
export const daysOverdue = (dueOn: string) =>
  Math.max(0, Math.round((Date.parse(new Date().toLocaleDateString("en-CA")) - Date.parse(dueOn)) / 86_400_000));
