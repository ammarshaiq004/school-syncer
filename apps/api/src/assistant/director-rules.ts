/** Last-90-days vs the 90 days before (the director's "what changed" view). Pure; AssistantData supplies the counts. */

export interface WindowMetric {
  key: string;
  label: string;
  current: number;
  previous: number;
  /** Whether a rise is good news (false for students leaving). */
  higherIsBetter: boolean;
  unit: 'count' | 'percent' | 'rupees';
}

export interface MetricChange extends WindowMetric {
  change: number;
  /** Relative change in percent; null when there was nothing before. */
  changePercent: number | null;
  trend: 'up' | 'down' | 'same';
  tone: 'good' | 'bad' | 'neutral';
  /** Big enough to mention: at least 10% (or any move from zero) and, for counts, more than one. */
  notable: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function compareWindows(metrics: WindowMetric[]): MetricChange[] {
  return metrics.map((m) => {
    const change = round1(m.current - m.previous);
    const changePercent = m.previous ? round1((change / m.previous) * 100) : null;
    const trend = change > 0 ? 'up' : change < 0 ? 'down' : 'same';
    const tone = trend === 'same' ? 'neutral' : (trend === 'up') === m.higherIsBetter ? 'good' : 'bad';
    const big = m.unit === 'percent' ? Math.abs(change) >= 3 : changePercent === null ? change !== 0 : Math.abs(changePercent) >= 10;
    const notable = big && (m.unit !== 'count' || Math.abs(change) > 1);
    return { ...m, change, changePercent, trend, tone, notable };
  });
}

/** Attendance percentage as the at-risk rules count it: late is attended, leave is missed. */
export const attendanceRate = (c: { present: number; late: number; absent: number; leave: number }): number => {
  const total = c.present + c.late + c.absent + c.leave;
  return total ? round1(((c.present + c.late) / total) * 100) : 0;
};
