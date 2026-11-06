import { attendanceRate, compareWindows, type WindowMetric } from './director-rules.js';

const m = (over: Partial<WindowMetric>): WindowMetric => ({ key: 'k', label: 'K', current: 0, previous: 0, higherIsBetter: true, unit: 'count', ...over });

describe('director window comparison', () => {
  it('marks a rise good and a fall bad when higher is better', () => {
    const [up, down] = compareWindows([m({ current: 30, previous: 20 }), m({ current: 10, previous: 20 })]);
    expect(up).toMatchObject({ change: 10, changePercent: 50, trend: 'up', tone: 'good', notable: true });
    expect(down).toMatchObject({ trend: 'down', tone: 'bad' });
  });

  it('reads more leavers as bad news', () => {
    expect(compareWindows([m({ current: 8, previous: 2, higherIsBetter: false })])[0]).toMatchObject({ tone: 'bad', notable: true });
  });

  it('does not make noise of small moves', () => {
    expect(compareWindows([m({ current: 21, previous: 20 })])[0].notable).toBe(false);
    expect(compareWindows([m({ current: 1, previous: 0 })])[0].notable).toBe(false);
    expect(compareWindows([m({ current: 2, previous: 0 })])[0]).toMatchObject({ changePercent: null, notable: true });
  });

  it('treats a 3 point attendance move as notable', () => {
    expect(compareWindows([m({ unit: 'percent', current: 90, previous: 94 })])[0]).toMatchObject({ notable: true, tone: 'bad' });
    expect(compareWindows([m({ unit: 'percent', current: 93, previous: 94 })])[0].notable).toBe(false);
  });

  it('is neutral when nothing changed', () => {
    expect(compareWindows([m({ current: 5, previous: 5 })])[0]).toMatchObject({ trend: 'same', tone: 'neutral', notable: false });
  });

  it('computes attendance rate with late as attended', () => {
    expect(attendanceRate({ present: 6, late: 2, absent: 1, leave: 1 })).toBe(80);
    expect(attendanceRate({ present: 0, late: 0, absent: 0, leave: 0 })).toBe(0);
  });
});
