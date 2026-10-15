import { checklistSummary, setupChecklist, type SetupFacts } from './setup-checklist.js';

const none: SetupFacts = {
  profile: false,
  currentYear: false,
  sections: 0,
  activeStudents: 0,
  feeHeads: 0,
  feeStructures: 0,
  staff: 0,
  messaging: false,
  onlinePayments: false,
  attendanceSessions: 0,
  vouchers: 0,
};
const all: SetupFacts = {
  profile: true,
  currentYear: true,
  sections: 4,
  activeStudents: 120,
  feeHeads: 2,
  feeStructures: 8,
  staff: 1,
  messaging: true,
  onlinePayments: true,
  attendanceSessions: 1,
  vouchers: 120,
};

describe('setupChecklist', () => {
  it('lists the ten items in order, each linking to its screen', () => {
    const items = setupChecklist(none);
    expect(items.map((i) => i.key)).toEqual([
      'profile',
      'academic-year',
      'classes',
      'students',
      'fees',
      'staff',
      'messaging',
      'online-payments',
      'attendance',
      'vouchers',
    ]);
    expect(items.every((i) => !i.done && i.href.startsWith('/'))).toBe(true);
    expect(items.filter((i) => i.optional).map((i) => i.key)).toEqual(['online-payments']);
  });

  it('needs both fee heads and class amounts', () => {
    const fees = (f: Partial<SetupFacts>) => setupChecklist({ ...none, ...f }).find((i) => i.key === 'fees')!;
    expect(fees({ feeHeads: 2 })).toMatchObject({ done: false, hint: 'Set what each class pays this year' });
    expect(fees({ feeStructures: 3 }).done).toBe(false);
    expect(fees({ feeHeads: 1, feeStructures: 3 })).toMatchObject({ done: true, hint: '1 fee head, 3 class amounts' });
  });

  it('describes what is done', () => {
    const items = setupChecklist(all);
    expect(items.find((i) => i.key === 'students')!.hint).toBe('120 active students');
    expect(items.find((i) => i.key === 'attendance')!.hint).toBe('1 register taken');
  });
});

describe('checklistSummary', () => {
  it('counts required items only and hides the card once they are done', () => {
    const items = setupChecklist({ ...all, onlinePayments: false });
    expect(checklistSummary(items, null)).toMatchObject({ done: 9, total: 9, complete: true, visible: false });
  });

  it('shows an unfinished checklist until it is dismissed', () => {
    const items = setupChecklist({ ...all, vouchers: 0 });
    expect(checklistSummary(items, null)).toMatchObject({ done: 8, complete: false, visible: true });
    expect(checklistSummary(items, new Date())).toMatchObject({ complete: false, visible: false });
  });
});
