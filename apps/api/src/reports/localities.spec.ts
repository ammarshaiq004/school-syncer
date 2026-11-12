import { describe, expect, it } from 'vitest';
import { localitySummary } from './localities.js';

const s = (localityId: string | null, gender: string) => ({ localityId, localityName: localityId && `Area ${localityId}`, gender });

describe('localitySummary', () => {
  it('counts boys and girls per area, biggest first, with unset last', () => {
    const rows = localitySummary([s(null, 'MALE'), s('b', 'MALE'), s('a', 'FEMALE'), s('a', 'MALE'), s(null, 'FEMALE'), s(null, 'MALE')]);
    expect(rows.map((r) => [r.name, r.total, r.boys, r.girls])).toEqual([['Area a', 2, 1, 1], ['Area b', 1, 1, 0], ['No locality set', 3, 2, 1]]);
  });

  it('is empty for no students', () => {
    expect(localitySummary([])).toEqual([]);
  });
});
