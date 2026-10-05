/** Reading a published exam result the same way on the parent, student and staff screens. */

/** The per-subject part of a published result (ExamResult.subjects). */
export interface ResultSubject {
  subject: string;
  marks: number | null;
  absent: boolean;
  passed: boolean;
}

/** "Science", "Maths and Science", "Urdu, Maths and Science". */
const names = (list: string[]) =>
  list.length < 2 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;

/**
 * Why a result did not pass, in words: "absent in Science", "failed in Maths",
 * or both. Null when no subject failed, so the caller just says "Not passed".
 */
export function notPassedReason(subjects: ResultSubject[] | undefined): string | null {
  const absent = (subjects ?? []).filter((s) => s.absent).map((s) => s.subject);
  const failed = (subjects ?? []).filter((s) => !s.passed && !s.absent).map((s) => s.subject);
  const parts: string[] = [];
  if (absent.length) parts.push(`absent in ${names(absent)}`);
  if (failed.length) parts.push(`failed in ${names(failed)}`);
  return parts.length ? parts.join(", ") : null;
}

/** "Not passed: absent in Science", or plain "Not passed" when the subjects say nothing. */
export function notPassedLabel(subjects?: ResultSubject[]) {
  const why = notPassedReason(subjects);
  return why ? `Not passed: ${why}` : "Not passed";
}
