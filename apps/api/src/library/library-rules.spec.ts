import {
  daysLate,
  dueDate,
  lateFine,
  nextAccessionNumbers,
} from './library-rules.js';

describe('dueDate', () => {
  it('adds the loan period, across months', () => {
    expect(dueDate('2026-09-25', 14)).toBe('2026-10-09');
  });
});

describe('lateFine', () => {
  it('charges each day after the due date', () => {
    expect(daysLate('2026-10-09', '2026-10-12')).toBe(3);
    expect(lateFine('2026-10-09', '2026-10-12', 5)).toBe(15);
  });

  it('charges nothing on time or early', () => {
    expect(lateFine('2026-10-09', '2026-10-09', 5)).toBe(0);
    expect(lateFine('2026-10-09', '2026-10-01', 5)).toBe(0);
  });
});

describe('nextAccessionNumbers', () => {
  it('continues after the highest plain number', () => {
    expect(nextAccessionNumbers(['1', '7', 'REF-99', '3'], 3)).toEqual([
      '8',
      '9',
      '10',
    ]);
    expect(nextAccessionNumbers([], 2)).toEqual(['1', '2']);
  });
});
