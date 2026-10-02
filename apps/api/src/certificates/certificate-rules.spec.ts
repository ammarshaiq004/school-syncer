import { CertificateType } from '@prisma/client';
import { dateInWords, nextSerial, verifyCode } from './certificate-rules.js';

describe('dateInWords', () => {
  it('writes dates of birth the way certificates print them', () => {
    expect(dateInWords('2014-03-15')).toBe(
      'Fifteenth March, Two Thousand and Fourteen',
    );
    expect(dateInWords('2010-12-31')).toBe(
      'Thirty-First December, Two Thousand and Ten',
    );
    expect(dateInWords('2020-06-20')).toBe(
      'Twentieth June, Two Thousand and Twenty',
    );
    expect(dateInWords('2000-01-01')).toBe('First January, Two Thousand');
    expect(dateInWords('1998-08-22')).toBe(
      'Twenty-Second August, Nineteen Ninety-Eight',
    );
  });
});

describe('nextSerial', () => {
  it('continues the year’s numbers for that kind of certificate', () => {
    const issued = ['SLC-2026-0007', 'SLC-2025-0040', 'CC-2026-0099'];
    expect(nextSerial(CertificateType.LEAVING, 2026, issued)).toBe(
      'SLC-2026-0008',
    );
    expect(nextSerial(CertificateType.ENROLMENT, 2026, issued)).toBe(
      'EC-2026-0001',
    );
  });
});

describe('verifyCode', () => {
  it('avoids characters that are easy to misread', () => {
    const code = verifyCode();
    expect(code).toHaveLength(10);
    expect(code).not.toMatch(/[01OIL]/);
  });
});
