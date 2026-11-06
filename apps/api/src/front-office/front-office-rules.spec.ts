import {
  canMoveComplaint,
  slipFor,
  upcomingBirthdays,
  visitMinutes,
} from './front-office-rules.js';

const born = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('upcomingBirthdays', () => {
  const rows = [
    { id: 'a', name: 'Ayesha', dateOfBirth: born('2015-11-05') },
    { id: 'b', name: 'Bilal', dateOfBirth: born('2014-11-12') },
    { id: 'c', name: 'Chand', dateOfBirth: born('2013-11-04') },
    { id: 'd', name: 'Danish', dateOfBirth: born('2012-01-02') },
  ];

  it('lists today first, then the next days, within the window', () => {
    const out = upcomingBirthdays(rows, '2026-11-05', 10);
    expect(out.map((b) => [b.name, b.daysAway, b.turning])).toEqual([
      ['Ayesha', 0, 11],
      ['Bilal', 7, 12],
    ]);
  });

  it('rolls over into next year', () => {
    const out = upcomingBirthdays(rows, '2026-12-30', 10);
    expect(out).toEqual([
      { id: 'd', name: 'Danish', date: '2027-01-02', daysAway: 3, turning: 15 },
    ]);
  });

  it('marks 29 February on the 28th in a common year', () => {
    const leap = [{ id: 'x', name: 'Leap', dateOfBirth: born('2016-02-29') }];
    expect(upcomingBirthdays(leap, '2027-02-20', 30)[0]).toMatchObject({ date: '2027-02-28', turning: 11 });
    expect(upcomingBirthdays(leap, '2028-02-20', 30)[0]).toMatchObject({ date: '2028-02-29', turning: 12 });
  });

  it('ignores a date of birth in the future and sorts ties by name', () => {
    const odd = [
      { id: '1', name: 'Zed', dateOfBirth: born('2010-11-06') },
      { id: '2', name: 'Amy', dateOfBirth: born('2011-11-06') },
      { id: '3', name: 'Future', dateOfBirth: born('2030-11-06') },
    ];
    expect(upcomingBirthdays(odd, '2026-11-05', 3).map((b) => b.name)).toEqual(['Amy', 'Zed']);
  });
});

describe('visitMinutes', () => {
  it('is null while the visitor is in, and never negative', () => {
    const inAt = new Date('2026-11-05T05:00:00Z');
    expect(visitMinutes(inAt, null)).toBeNull();
    expect(visitMinutes(inAt, new Date('2026-11-05T05:25:00Z'))).toBe(25);
    expect(visitMinutes(inAt, new Date('2026-11-05T04:00:00Z'))).toBe(0);
  });
});

describe('canMoveComplaint', () => {
  it('only moves forward', () => {
    expect(canMoveComplaint('OPEN', 'IN_PROGRESS')).toBe(true);
    expect(canMoveComplaint('OPEN', 'RESOLVED')).toBe(true);
    expect(canMoveComplaint('RESOLVED', 'OPEN')).toBe(false);
    expect(canMoveComplaint('IN_PROGRESS', 'IN_PROGRESS')).toBe(false);
  });
});

describe('slipFor', () => {
  it('puts the primary guardian first and joins the address with the locality', () => {
    const slip = slipFor({
      admissionNo: 'A-1',
      rollNo: 3,
      name: 'Sara Khan',
      gender: 'FEMALE',
      dateOfBirth: born('2015-03-04'),
      address: 'House 5, Street 2',
      locality: 'Model Town',
      guardians: [
        { name: 'Mother', relation: 'Mother', phone: '0300', isPrimary: false },
        { name: 'Father', relation: 'Father', phone: '0301', isPrimary: true },
      ],
    });
    expect(slip.guardians.map((g) => g.name)).toEqual(['Father', 'Mother']);
    expect(slip.address).toBe('House 5, Street 2, Model Town');
    expect(slip.dateOfBirth).toBe('2015-03-04');
  });

  it('leaves the address empty when there is none', () => {
    const slip = slipFor({
      admissionNo: 'A-2', rollNo: null, name: 'X', gender: 'MALE', dateOfBirth: null,
      address: null, locality: null, guardians: [],
    });
    expect(slip.address).toBeNull();
    expect(slip.dateOfBirth).toBeNull();
  });
});
