import { describe, expect, it } from 'vitest';
import { datewiseCounts, rankAbsences, validRange } from './attendance-reports.js';
import { parseScanCode, scanStatus, staffCode, studentCode } from './qr.js';

describe('parseScanCode', () => {
  it('reads student and staff codes', () => {
    expect(parseScanCode(studentCode('A-101'))).toEqual({ kind: 'student', value: 'A-101' });
    expect(parseScanCode(' ss:e:EMP-0004 ')).toEqual({ kind: 'staff', value: 'EMP-0004' });
  });
  it('treats a bare number as either kind and rejects junk', () => {
    expect(parseScanCode('EMP-0004')).toEqual({ kind: 'any', value: 'EMP-0004' });
    expect(parseScanCode('')).toBeNull();
    expect(parseScanCode('SS:X:1')).toBeNull();
  });
  it('round-trips staff codes', () => {
    expect(parseScanCode(staffCode('EMP-1'))?.kind).toBe('staff');
  });
});

describe('scanStatus', () => {
  // 03:00Z is 08:00 in Karachi (UTC+5).
  it('is present before the cut-off and late after it', () => {
    expect(scanStatus(new Date('2026-11-05T03:00:00Z'), '08:30', 'Asia/Karachi')).toBe('PRESENT');
    expect(scanStatus(new Date('2026-11-05T03:30:00Z'), '08:30', 'Asia/Karachi')).toBe('PRESENT');
    expect(scanStatus(new Date('2026-11-05T03:31:00Z'), '08:30', 'Asia/Karachi')).toBe('LATE');
  });
  it('uses the school day, not UTC', () => {
    // 19:30Z is 00:30 next day in Karachi, which is before 08:30.
    expect(scanStatus(new Date('2026-11-05T19:30:00Z'), '08:30', 'Asia/Karachi')).toBe('PRESENT');
  });
});

describe('validRange', () => {
  it('accepts forward ranges up to 92 days', () => {
    expect(validRange('2026-11-01', '2026-11-05')).toBe(true);
    expect(validRange('2026-11-05', '2026-11-05')).toBe(true);
    expect(validRange('2026-08-05', '2026-11-04')).toBe(true);
  });
  it('rejects backwards and oversized ranges', () => {
    expect(validRange('2026-11-06', '2026-11-05')).toBe(false);
    expect(validRange('2026-01-01', '2026-11-05')).toBe(false);
  });
});

describe('datewiseCounts', () => {
  it('counts per day in date order with a rate', () => {
    const out = datewiseCounts([
      { date: '2026-11-03', status: 'ABSENT' },
      { date: '2026-11-02', status: 'PRESENT' },
      { date: '2026-11-02', status: 'LATE' },
      { date: '2026-11-02', status: 'ABSENT' },
      { date: '2026-11-02', status: 'LEAVE' },
    ]);
    expect(out.map((d) => d.date)).toEqual(['2026-11-02', '2026-11-03']);
    expect(out[0]).toMatchObject({ PRESENT: 1, LATE: 1, ABSENT: 1, LEAVE: 1, rate: 50 });
    expect(out[1].rate).toBe(0);
  });
  it('is empty when nothing was marked', () => expect(datewiseCounts([])).toEqual([]));
});

describe('rankAbsences', () => {
  const rows = [
    { userId: 'a', name: 'Ayesha', status: 'ABSENT' as const },
    { userId: 'a', name: 'Ayesha', status: 'PRESENT' as const },
    { userId: 'b', name: 'Bilal', status: 'ABSENT' as const },
    { userId: 'b', name: 'Bilal', status: 'ABSENT' as const },
    { userId: 'c', name: 'Chand', status: 'LATE' as const },
    { userId: 'd', name: 'Dua', status: 'PRESENT' as const },
    { userId: 'e', name: 'Emaan', status: 'LEAVE' as const },
  ];
  it('ranks by absences then lateness and skips clean records', () => {
    expect(rankAbsences(rows, 10).map((r) => r.userId)).toEqual(['b', 'a', 'c']);
    expect(rankAbsences(rows, 10)[1]).toMatchObject({ ABSENT: 1, PRESENT: 1, marked: 2 });
  });
  it('honours the limit', () => expect(rankAbsences(rows, 1)).toHaveLength(1));
});
