import { describe, expect, it } from 'vitest';
import { localDate } from '../common/dates.js';
import { receivedInstant } from './paid-on.js';

const now = new Date('2026-11-12T08:00:00Z');

describe('receivedInstant', () => {
  it('uses the current time for no date or today', () => {
    expect(receivedInstant(undefined, '2026-11-12', now)).toBe(now);
    expect(receivedInstant('2026-11-12', '2026-11-12', now)).toBe(now);
  });

  it('stamps an earlier day so reports file it on that local day', () => {
    const at = receivedInstant('2026-06-03', '2026-11-12', now);
    expect(localDate(at)).toBe('2026-06-03');
  });

  it('refuses a future day', () => {
    expect(() => receivedInstant('2026-11-13', '2026-11-12', now)).toThrow('future');
  });
});
