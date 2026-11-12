import { BadRequestException } from '@nestjs/common';
import { StudentStatus } from '@prisma/client';

export const DEFAULT_LEAVING_REASONS = [
  'Fee Defaulter',
  'Migration',
  'Misbehaviour',
  'Regular Absents',
  'Duplicate Entry',
  'Wrong Entry',
  'Course Completed',
  'Other',
];

/**
 * The leaving columns to save when a student's status changes. Leaving, graduating or being
 * suspended needs one of the school's reasons (remarks are optional) and records what the student
 * owed that day; coming back to ACTIVE clears all three. Other edits leave them alone.
 */
export function leavingDetails(i: {
  before: { status: StudentStatus; leavingReason: string | null; leavingRemarks: string | null; leavingBalance: number | null };
  status?: StudentStatus;
  reason?: string;
  remarks?: string;
  reasons: string[];
  /** Outstanding balance net of credit, evaluated only when it is needed. */
  balance: () => Promise<number>;
}): Promise<{ leavingReason?: string | null; leavingRemarks?: string | null; leavingBalance?: number | null }> {
  return (async () => {
    const status = i.status ?? i.before.status;
    if (status === StudentStatus.ACTIVE) {
      return i.before.status === StudentStatus.ACTIVE ? {} : { leavingReason: null, leavingRemarks: null, leavingBalance: null };
    }
    const changing = i.status !== undefined && i.status !== i.before.status;
    const reason = i.reason ?? (changing ? undefined : i.before.leavingReason ?? undefined);
    if (!reason) {
      if (!changing) return {};
      throw new BadRequestException('Choose a reason for leaving');
    }
    if (!i.reasons.includes(reason) && reason !== i.before.leavingReason) {
      throw new BadRequestException(`"${reason}" is not one of the school's leaving reasons`);
    }
    return {
      leavingReason: reason,
      leavingRemarks: i.remarks ?? (changing ? null : i.before.leavingRemarks),
      leavingBalance: changing || i.before.leavingBalance === null ? await i.balance() : i.before.leavingBalance,
    };
  })();
}
