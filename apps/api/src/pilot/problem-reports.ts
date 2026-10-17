import { ProblemReportSource, ProblemReportStatus, type Prisma } from '@prisma/client';
import { z } from 'zod';

/** "Report a problem" (SCHOOL-150): what the apps send, and what each side sees. */

/** Reports one user may send per hour, and screenshots they may upload. */
export const REPORTS_PER_HOUR = 10;
export const SCREENSHOTS_PER_HOUR = 10;
export const HOUR_MS = 60 * 60_000;

export const OPEN_STATUSES: ProblemReportStatus[] = [ProblemReportStatus.NEW, ProblemReportStatus.IN_PROGRESS];

export const STATUS_LABEL: Record<ProblemReportStatus, string> = {
  NEW: 'New',
  IN_PROGRESS: 'In progress',
  FIXED: 'Fixed',
  WONT_FIX: "Won't fix",
};

const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    // Control characters (and the new lines a header would need) are dropped.
    // eslint-disable-next-line no-control-regex
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim());

export const reportSchema = z.object({
  message: z.string().trim().min(5, 'Say a little more about what went wrong').max(4000),
  page: oneLine(500).pipe(z.string().min(1, 'Which page or screen were you on?')),
  source: z.enum(ProblemReportSource).default(ProblemReportSource.WEB),
  appVersion: oneLine(60).optional(),
  /** Left out: the request's User-Agent is kept instead. */
  browser: oneLine(500).optional(),
  screenshotId: z.string().min(1).max(40).optional(),
});
export type ReportInput = z.infer<typeof reportSchema>;

export const statusSchema = z.object({ status: z.enum(ProblemReportStatus) });
export const noteSchema = z.object({ note: z.string().trim().min(1).max(4000) });

export const listQuerySchema = z.object({
  status: z.enum(ProblemReportStatus).optional(),
  /** Every report still open (new or in progress). */
  open: z.enum(['true', 'false']).optional(),
  schoolId: z.string().max(40).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export const reportInclude = {
  activity: { orderBy: { createdAt: 'asc' } },
  screenshot: true,
} satisfies Prisma.ProblemReportInclude;

type ReportRow = Prisma.ProblemReportGetPayload<{ include: typeof reportInclude }>;

/** What the school sees: status changes, never the internal notes or who at SchoolSyncer wrote them. */
export function schoolView(r: ReportRow) {
  return {
    id: r.id,
    message: r.message,
    page: r.page,
    source: r.source,
    appVersion: r.appVersion,
    browser: r.browser,
    roles: r.roles,
    reporterId: r.reporterId,
    reporterName: r.reporterName,
    status: r.status,
    statusChangedAt: r.statusChangedAt,
    createdAt: r.createdAt,
    hasScreenshot: Boolean(r.screenshotId),
    history: r.activity
      .filter((a) => a.status !== null)
      .map((a) => ({ status: a.status!, fromStatus: a.fromStatus, at: a.createdAt })),
  };
}

/** What the console sees: everything, notes included. */
export function consoleView(r: ReportRow) {
  return {
    ...schoolView(r),
    schoolId: r.schoolId,
    updatedAt: r.updatedAt,
    activity: r.activity.map((a) => ({
      id: a.id,
      at: a.createdAt,
      adminId: a.adminId,
      adminName: a.adminName,
      status: a.status,
      fromStatus: a.fromStatus,
      note: a.note,
    })),
  };
}
