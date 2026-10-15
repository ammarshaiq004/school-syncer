/**
 * The owner's setup checklist (SCHOOL-150): what a school still has to do
 * before it can run a month in SchoolSyncer. Each item links to the web
 * screen that does it.
 */
export interface SetupFacts {
  /** The school's phone and city are filled in. */
  profile: boolean;
  currentYear: boolean;
  /** Sections in the current academic year. */
  sections: number;
  activeStudents: number;
  feeHeads: number;
  /** Fee structures for the current year. */
  feeStructures: number;
  /** Active staff accounts other than owners. */
  staff: number;
  /** Messages are delivered (the school's own sender or the platform's), not only logged. */
  messaging: boolean;
  /** A real payment gateway takes parents' payments. */
  onlinePayments: boolean;
  attendanceSessions: number;
  vouchers: number;
}

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  optional: boolean;
  /** The web screen that fixes it. */
  href: string;
  hint: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function setupChecklist(f: SetupFacts): ChecklistItem[] {
  const item = (key: string, label: string, done: boolean, href: string, hint: string, optional = false) => ({
    key,
    label,
    done,
    optional,
    href,
    hint,
  });
  return [
    item('profile', 'School profile', f.profile, '/settings', f.profile ? 'Phone and city are filled in' : 'Add the school phone and city printed on vouchers'),
    item('academic-year', 'Academic year', f.currentYear, '/classes', f.currentYear ? 'A current year is set' : 'Add this year and mark it current'),
    item('classes', 'Classes and sections', f.sections > 0, '/classes', f.sections ? `${plural(f.sections, 'section')} this year` : 'Add classes and their sections for this year'),
    item('students', 'Students imported', f.activeStudents > 0, '/students/import', f.activeStudents ? plural(f.activeStudents, 'active student') : 'Import students from Excel'),
    item(
      'fees',
      'Fee heads and structures',
      f.feeHeads > 0 && f.feeStructures > 0,
      '/fees#setup',
      f.feeHeads && f.feeStructures
        ? `${plural(f.feeHeads, 'fee head')}, ${plural(f.feeStructures, 'class amount')}`
        : f.feeHeads
          ? 'Set what each class pays this year'
          : 'Add fee heads such as Tuition, then what each class pays',
    ),
    item('staff', 'Staff accounts', f.staff > 0, '/staff', f.staff ? plural(f.staff, 'staff account') : 'Give teachers and the fee office their own logins'),
    item('messaging', 'Messaging sender', f.messaging, '/settings?tab=messaging', f.messaging ? 'Messages to parents are delivered' : 'Messages are only logged until a WhatsApp or SMS sender is set'),
    item('online-payments', 'Online payments', f.onlinePayments, '/settings?tab=payments', f.onlinePayments ? 'Parents can pay online' : 'Optional: let parents pay by JazzCash, Easypaisa or 1Bill', true),
    item('attendance', 'First attendance marked', f.attendanceSessions > 0, '/attendance', f.attendanceSessions ? plural(f.attendanceSessions, 'register') + ' taken' : 'Take the first daily register'),
    item('vouchers', 'First vouchers generated', f.vouchers > 0, '/fees', f.vouchers ? plural(f.vouchers, 'voucher') + ' issued' : "Generate this month's fee vouchers"),
  ];
}

/** Progress on the required items; the card is shown until they are all done or it is dismissed. */
export function checklistSummary(items: ChecklistItem[], dismissedAt: Date | null) {
  const required = items.filter((i) => !i.optional);
  const done = required.filter((i) => i.done).length;
  const complete = done === required.length;
  return { items, done, total: required.length, complete, dismissedAt, visible: !complete && !dismissedAt };
}
