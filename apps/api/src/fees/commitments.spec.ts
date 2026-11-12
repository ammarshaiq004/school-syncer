import { describe, expect, it } from 'vitest';
import { checkCommitment, commitmentStatus } from './commitments.js';

describe('commitmentStatus', () => {
  it('is kept once enough was paid by the promised day', () => {
    expect(commitmentStatus(3000, '2026-11-15', 3000, '2026-11-12')).toBe('KEPT');
    expect(commitmentStatus(3000, '2026-11-15', 3500, '2026-11-20')).toBe('KEPT');
  });

  it('is pending until the promised day is over, then broken', () => {
    expect(commitmentStatus(3000, '2026-11-15', 1000, '2026-11-15')).toBe('PENDING');
    expect(commitmentStatus(3000, '2026-11-15', 1000, '2026-11-16')).toBe('BROKEN');
  });
});

describe('checkCommitment', () => {
  it('needs a whole positive amount and a date that is not past', () => {
    expect(() => checkCommitment(3000, '2026-11-12', '2026-11-12')).not.toThrow();
    expect(() => checkCommitment(0, '2026-11-12', '2026-11-12')).toThrow('whole rupees');
    expect(() => checkCommitment(10.5, '2026-11-12', '2026-11-12')).toThrow();
    expect(() => checkCommitment(100, '2026-11-11', '2026-11-12')).toThrow('past');
  });
});
