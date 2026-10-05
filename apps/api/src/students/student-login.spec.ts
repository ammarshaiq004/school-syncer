import { studentUsername, tempPassword } from './student-login.js';

describe('studentUsername', () => {
  it('lowercases and trims the admission number', () => {
    expect(studentUsername(' DS-2026-0042 ')).toBe('ds-2026-0042');
    expect(studentUsername('2026-0001')).toBe('2026-0001');
  });
});

describe('tempPassword', () => {
  it('is four letters then four digits without look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const p = tempPassword();
      expect(p).toMatch(/^[a-z]{4}[2-9]{4}$/);
      expect(p).not.toMatch(/[ilo01]/);
    }
  });

  it('uses the picker it is given', () => {
    expect(tempPassword(() => 0)).toBe('aaaa2222');
  });
});
