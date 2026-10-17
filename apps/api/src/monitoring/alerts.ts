/** Something wrong now, as one alert check found it. */
export interface Problem {
  /** Stable across runs while the same problem lasts, e.g. "jobs.failed". */
  key: string;
  severity: 'warning' | 'critical';
  summary: string;
  detail?: string;
}

/** What is stored of an alert (PlatformAlert). */
export interface AlertState {
  key: string;
  summary: string;
  lastNotifiedAt: Date | null;
  resolvedAt: Date | null;
}

export interface AlertPlan {
  /** Problems seen this run, each with whether admins hear about it now. */
  open: { problem: Problem; isNew: boolean; notify: boolean }[];
  /** Open alerts no longer found: closed now, and admins told once. */
  resolved: AlertState[];
}

/**
 * Decides who hears what. A new problem (or one that came back after being
 * resolved) is announced at once; one still open is repeated only when
 * `repeatMs` has passed since admins were last told, so a run every five
 * minutes does not page anyone every five minutes; an open alert the run
 * no longer finds is resolved, with one "resolved" notice.
 */
export function planAlerts(states: AlertState[], problems: Problem[], now: Date, repeatMs: number): AlertPlan {
  const byKey = new Map(states.map((s) => [s.key, s]));
  const found = new Set(problems.map((p) => p.key));
  const open = problems.map((problem) => {
    const state = byKey.get(problem.key);
    const isNew = !state || state.resolvedAt !== null;
    const due = isNew || !state.lastNotifiedAt || now.getTime() - state.lastNotifiedAt.getTime() >= repeatMs;
    return { problem, isNew, notify: due };
  });
  const resolved = states.filter((s) => s.resolvedAt === null && !found.has(s.key));
  return { open, resolved };
}

/** The text of one round of notifications (Slack-style markdown, also fine as plain text). */
export function alertText(plan: AlertPlan, environment: string): string | null {
  const lines: string[] = [];
  for (const { problem, isNew, notify } of plan.open) {
    if (!notify) continue;
    const label = problem.severity === 'critical' ? 'CRITICAL' : 'Warning';
    lines.push(`• ${label}${isNew ? '' : ' (still open)'}: ${problem.summary}${problem.detail ? `\n    ${problem.detail}` : ''}`);
  }
  for (const r of plan.resolved) lines.push(`• Resolved: ${r.summary}`);
  if (!lines.length) return null;
  return `*SchoolSyncer alerts* (${environment})\n${lines.join('\n')}`;
}
