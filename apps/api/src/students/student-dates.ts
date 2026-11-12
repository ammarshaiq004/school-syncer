import { BadRequestException } from '@nestjs/common';
import { StudentStatus } from '@prisma/client';

const day = (d: Date) => d.toISOString().slice(0, 10);

export interface StudentDateInput {
  /** The student as saved now (omit on create). */
  before?: { status: StudentStatus; admittedOn: Date; leftOn: Date | null };
  status?: StudentStatus;
  admittedOn?: Date;
  leftOn?: Date | null;
  /** The school's today, YYYY-MM-DD. */
  today: string;
}

/**
 * The admission and leaving dates to save, so records moved from an old system keep their real
 * dates. A leaving date belongs to a LEFT student only (default: today, or the date already on
 * file) and can't be before admission or in the future. Throws a 400 with a message for the user, or
 * returns the columns to write.
 */
export function studentDates(i: StudentDateInput): { admittedOn?: Date; leftOn?: Date | null } {
  const status = i.status ?? i.before?.status ?? StudentStatus.ACTIVE;
  const admittedOn = i.admittedOn ?? i.before?.admittedOn;
  if (i.admittedOn && day(i.admittedOn) > i.today) throw new BadRequestException('Admission date cannot be in the future');
  if (i.leftOn && status !== StudentStatus.LEFT) {
    throw new BadRequestException('A leaving date only applies to a student marked Left');
  }

  let leftOn: Date | null | undefined;
  if (status === StudentStatus.LEFT) {
    const kept = i.before?.status === StudentStatus.LEFT ? i.before.leftOn : null;
    // Saving "Left" again, or only changing other fields, keeps the date on file.
    leftOn = i.leftOn ?? kept ?? new Date(`${i.today}T00:00:00.000Z`);
    if (day(leftOn) > i.today) throw new BadRequestException('Leaving date cannot be in the future');
    if (admittedOn && day(leftOn) < day(admittedOn)) throw new BadRequestException('Leaving date is before the admission date');
  } else if (i.status || i.before?.leftOn) {
    leftOn = null;
  }
  if (admittedOn && leftOn === undefined && i.before?.leftOn && day(i.before.leftOn) < day(admittedOn)) {
    throw new BadRequestException('Admission date is after the leaving date');
  }
  return { ...(i.admittedOn ? { admittedOn: i.admittedOn } : {}), ...(leftOn !== undefined ? { leftOn } : {}) };
}
