import { startOfLocalDay } from './dates.js';

describe('startOfLocalDay', () => {
  it('returns local midnight in Pakistan as 19:00 UTC the day before', () => {
    expect(startOfLocalDay('2026-10-02', 'Asia/Karachi').toISOString()).toBe('2026-10-01T19:00:00.000Z');
  });

  it('is plain midnight in UTC', () => {
    expect(startOfLocalDay('2026-10-02', 'UTC').toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });
});
