import { monthBounds, riderFee, ridesDuring } from './transport-rules.js';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('riderFee', () => {
  it("uses the stop's fee when it has one", () => {
    expect(riderFee({ monthlyFee: 4000 }, { monthlyFee: 5500 })).toBe(5500);
    expect(riderFee({ monthlyFee: 4000 }, { monthlyFee: null })).toBe(4000);
    expect(riderFee({ monthlyFee: 4000 }, null)).toBe(4000);
  });
});

describe('monthBounds', () => {
  it('knows month lengths', () => {
    expect(monthBounds('2026-02')).toEqual({
      first: '2026-02-01',
      last: '2026-02-28',
    });
    expect(monthBounds('2028-02').last).toBe('2028-02-29');
  });
});

describe('ridesDuring', () => {
  it('charges any month the student rode in', () => {
    expect(
      ridesDuring({ startsOn: d('2026-09-20'), endsOn: null }, '2026-09'),
    ).toBe(true);
    expect(
      ridesDuring({ startsOn: d('2026-09-20'), endsOn: null }, '2026-10'),
    ).toBe(true);
    expect(
      ridesDuring(
        { startsOn: d('2026-04-01'), endsOn: d('2026-10-05') },
        '2026-10',
      ),
    ).toBe(true);
  });

  it('skips months before they started or after they stopped', () => {
    expect(
      ridesDuring({ startsOn: d('2026-09-20'), endsOn: null }, '2026-08'),
    ).toBe(false);
    expect(
      ridesDuring(
        { startsOn: d('2026-04-01'), endsOn: d('2026-09-30') },
        '2026-10',
      ),
    ).toBe(false);
  });
});
