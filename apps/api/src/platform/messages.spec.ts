import { recipientsWhere } from './messages.js';

const now = new Date('2026-10-29T00:00:00Z');

describe('recipientsWhere', () => {
  it('leaves cancelled schools out of everyone and of a chosen list', () => {
    expect(recipientsWhere('ALL', [], now)).toEqual({ status: { not: 'CANCELLED' } });
    expect(recipientsWhere('CHOSEN', ['a', 'b'], now)).toEqual({ status: { not: 'CANCELLED' }, schoolId: { in: ['a', 'b'] } });
  });

  it('picks past-due schools, and trials ending within a week or already over', () => {
    expect(recipientsWhere('OVERDUE', [], now)).toEqual({ status: 'PAST_DUE' });
    expect(recipientsWhere('TRIALS_ENDING', [], now)).toEqual({ status: 'TRIAL', trialEndsAt: { lte: new Date('2026-11-05T00:00:00Z') } });
  });
});
