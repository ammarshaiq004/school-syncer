import { daysBefore, startOfLocalDay } from './dates.js';

describe('startOfLocalDay', () => {
  it('returns local midnight in Pakistan as 19:00 UTC the day before', () => {
    expect(startOfLocalDay('2026-10-02', 'Asia/Karachi').toISOString()).toBe('2026-10-01T19:00:00.000Z');
  });

  it('is plain midnight in UTC', () => {
    expect(startOfLocalDay('2026-10-02', 'UTC').toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });
});

describe('daysBefore', () => {
  it('crosses month and year boundaries', () => {
    expect(daysBefore('2026-10-02', 7)).toBe('2026-09-25');
    expect(daysBefore('2027-01-01', 1)).toBe('2026-12-31');
  });
});
