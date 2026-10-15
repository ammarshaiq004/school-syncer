/** "Report a problem" (SCHOOL-150): shapes of /problem-reports and how statuses read. */

export type ProblemStatus = "NEW" | "IN_PROGRESS" | "FIXED" | "WONT_FIX";

export const PROBLEM_STATUSES: ProblemStatus[] = ["NEW", "IN_PROGRESS", "FIXED", "WONT_FIX"];
export const PROBLEM_STATUS_LABEL: Record<ProblemStatus, string> = { NEW: "New", IN_PROGRESS: "In progress", FIXED: "Fixed", WONT_FIX: "Won't fix" };
export const PROBLEM_STATUS_TONE = { NEW: "info", IN_PROGRESS: "warning", FIXED: "success", WONT_FIX: "neutral" } as const;

/** One report as the school sees it (apps/api/src/pilot/problem-reports.ts schoolView). */
export interface ProblemReport {
  id: string;
  message: string;
  page: string;
  source: "WEB" | "MOBILE";
  appVersion: string | null;
  browser: string | null;
  roles: string[];
  reporterId: string | null;
  reporterName: string;
  status: ProblemStatus;
  statusChangedAt: string | null;
  createdAt: string;
  hasScreenshot: boolean;
  history: { status: ProblemStatus; fromStatus: ProblemStatus | null; at: string }[];
}

/**
 * "Chrome 141 on Windows" from a user agent, for a quick read in the console
 * (the full text stays on the report). Falls back to the first 60 characters.
 */
export function describeBrowser(ua: string | null | undefined): string {
  if (!ua) return "Unknown";
  const os = /Android [\d.]+/.exec(ua)?.[0] ?? (/iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : null);
  const browsers: [RegExp, string][] = [
    [/Edg\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/SamsungBrowser\/(\d+)/, "Samsung Internet"],
    [/Firefox\/(\d+)/, "Firefox"],
    [/Chrome\/(\d+)/, "Chrome"],
    [/Version\/(\d+).*Safari/, "Safari"],
  ];
  for (const [re, name] of browsers) {
    const m = re.exec(ua);
    if (m) return `${name} ${m[1]}${os ? ` on ${os}` : ""}`;
  }
  return ua.length > 60 ? `${ua.slice(0, 60)}…` : ua;
}
