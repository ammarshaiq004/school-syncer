type Env = Record<string, string | undefined>;

/** A positive number from the environment, or the default when unset or not a positive number. */
function positive(env: Env, key: string, fallback: number): number {
  const n = Number(env[key]?.trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Readiness and alert thresholds. Every one has a default that suits a
 * pilot, so nothing needs configuring; see docs/secrets.md (monitoring).
 */
export function monitoringSettings(env: Env = process.env) {
  const every = env.ALERT_EVERY_MINUTES?.trim().toLowerCase();
  return {
    /** Readiness fails when the oldest due job has waited longer than this. */
    maxJobLagMs: positive(env, 'READY_MAX_JOB_LAG_SECONDS', 900) * 1000,
    /** ... or when more jobs than this are due at once. */
    maxJobBacklog: positive(env, 'READY_MAX_JOB_BACKLOG', 10_000),
    /** ... or when the last successful nightly reconciliation is older than this. */
    maxReconcileAgeMs: positive(env, 'READY_MAX_RECONCILE_AGE_HOURS', 36) * 3_600_000,
    /** Alert when at least this many jobs failed for good in the last hour. */
    failedJobs: positive(env, 'ALERT_FAILED_JOBS', 5),
    /** Alert when this share (percent) of the last hour's messages failed... */
    messageFailurePercent: positive(env, 'ALERT_MESSAGE_FAILURE_PERCENT', 20),
    /** ... out of at least this many, so two failures out of three is not an alert. */
    messageMinCount: positive(env, 'ALERT_MESSAGE_MIN_COUNT', 20),
    /** An open problem is repeated to admins at most this often. */
    repeatMs: positive(env, 'ALERT_REPEAT_MINUTES', 360) * 60_000,
    /** How often the alert check runs; null with ALERT_EVERY_MINUTES=off. */
    everyMinutes: every === 'off' ? null : Math.min(60, Math.max(1, Math.round(positive(env, 'ALERT_EVERY_MINUTES', 5)))),
    webhookUrl: env.ALERT_WEBHOOK_URL?.trim() || null,
  };
}

export type MonitoringSettings = ReturnType<typeof monitoringSettings>;
