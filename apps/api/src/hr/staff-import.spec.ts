import { Role } from '@prisma/client';
import { checkStaffRows, parseRupees, staffRowSchema, type StaffRow } from './staff-import.js';

const row = (over: Partial<StaffRow> = {}): StaffRow =>
  staffRowSchema.parse({ name: 'Ayesha Khan', designation: 'Maths teacher', phone: '0300 1234567', ...over });
const none = () => ({ emails: new Set<string>(), phones: new Set<string>(), employeeNos: new Set<string>() });

describe('parseRupees', () => {
  it('reads amounts as typed', () => {
    expect(parseRupees('45,000')).toBe(45000);
    expect(parseRupees('Rs. 45000.4')).toBe(45000);
    expect(parseRupees('')).toBe(0);
    expect(parseRupees('forty')).toBeUndefined();
    expect(parseRupees('-5')).toBeUndefined();
  });
});

describe('checkStaffRows', () => {
  it('accepts a good row and fills defaults', () => {
    const [r] = checkStaffRows([row({ basicSalary: '40,000', joinedOn: '01/04/2024', cnic: '35202-1234567-1' })], none());
    expect(r.errors).toEqual([]);
    expect(r.staff).toMatchObject({ role: Role.TEACHER, phone: '03001234567', basicSalary: 40000, cnic: '3520212345671' });
    expect(r.staff?.joinedOn?.toISOString()).toBe('2024-04-01T00:00:00.000Z');
  });

  it('numbers rows from 2 and lists every problem', () => {
    const [r] = checkStaffRows([row({ name: '', designation: '', phone: '123', email: 'x', role: 'principal' })], none());
    expect(r.row).toBe(2);
    expect(r.errors).toHaveLength(5);
    expect(r.staff).toBeUndefined();
  });

  it('needs an email or a phone', () => {
    const [r] = checkStaffRows([row({ phone: '' })], none());
    expect(r.errors).toContain('Give an email or a phone number');
  });

  it('refuses contacts already used at the school and repeated in the file', () => {
    const taken = none();
    taken.phones.add('03001234567');
    const [a] = checkStaffRows([row()], taken);
    expect(a.errors[0]).toMatch(/already used/);
    const [first, second] = checkStaffRows(
      [row({ email: 'a@x.pk', phone: '' }), row({ name: 'Bilal Ahmed', email: 'A@x.pk', phone: '' })],
      none(),
    );
    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual(['Email a@x.pk is also on row 2']);
  });
});
