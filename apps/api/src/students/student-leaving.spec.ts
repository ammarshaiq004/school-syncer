import { StudentStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { leavingDetails } from './student-leaving.js';

const active = { status: StudentStatus.ACTIVE, leavingReason: null, leavingRemarks: null, leavingBalance: null };
const left = { status: StudentStatus.LEFT, leavingReason: 'Migration', leavingRemarks: 'Moved to Lahore', leavingBalance: 4200 };
const reasons = ['Migration', 'Fee Defaulter', 'Other'];

describe('leavingDetails', () => {
  it('requires a reason when a student leaves, and records the balance that day', async () => {
    const balance = vi.fn().mockResolvedValue(4200);
    await expect(leavingDetails({ before: active, status: StudentStatus.LEFT, reasons, balance })).rejects.toThrow('Choose a reason');
    await expect(
      leavingDetails({ before: active, status: StudentStatus.LEFT, reason: 'Moved', reasons, balance }),
    ).rejects.toThrow('not one of');
    expect(
      await leavingDetails({ before: active, status: StudentStatus.SUSPENDED, reason: 'Other', remarks: 'A week', reasons, balance }),
    ).toEqual({ leavingReason: 'Other', leavingRemarks: 'A week', leavingBalance: 4200 });
  });

  it('clears everything when the student comes back', async () => {
    expect(await leavingDetails({ before: left, status: StudentStatus.ACTIVE, reasons, balance: async () => 0 })).toEqual({
      leavingReason: null,
      leavingRemarks: null,
      leavingBalance: null,
    });
    expect(await leavingDetails({ before: active, reasons, balance: async () => 0 })).toEqual({});
  });

  it('keeps what is on file for a student who has already left, and accepts a later reason edit', async () => {
    const balance = vi.fn();
    expect(await leavingDetails({ before: left, reasons, balance })).toEqual({
      leavingReason: 'Migration',
      leavingRemarks: 'Moved to Lahore',
      leavingBalance: 4200,
    });
    expect(await leavingDetails({ before: left, reason: 'Fee Defaulter', reasons, balance })).toMatchObject({ leavingReason: 'Fee Defaulter', leavingBalance: 4200 });
    expect(balance).not.toHaveBeenCalled();
  });
});
