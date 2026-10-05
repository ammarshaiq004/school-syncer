import { phoneSearchDigits, toInternational } from './phone.js';
import { loggableText } from './templates.js';

describe('toInternational', () => {
  it('converts Pakistani mobile formats to 92XXXXXXXXXX', () => {
    expect(toInternational('0300-1234567')).toBe('923001234567');
    expect(toInternational('+92 300 1234567')).toBe('923001234567');
    expect(toInternational('3001234567')).toBe('923001234567');
  });
});

describe('loggableText', () => {
  it('masks passwords in the delivery log', () => {
    const text = loggableText('parent.invite', {
      schoolName: 'Demo',
      schoolCode: 'demo',
      login: '03001234567',
      password: '12345678',
    });
    expect(text).not.toContain('12345678');
    expect(text).toContain('03001234567');
  });
});

describe('phoneSearchDigits', () => {
  it('drops formatting and the 0 / +92 prefix', () => {
    for (const q of ['0300-1234567', '+923001234567', '03001234567', '0092 300 1234567'])
      expect(phoneSearchDigits(q)).toBe('3001234567');
    expect(phoneSearchDigits('042-35761234')).toBe('4235761234');
  });

  it('ignores names, emails and short numbers', () => {
    expect(phoneSearchDigits('Green Valley')).toBeNull();
    expect(phoneSearchDigits('owner2@demo.pk')).toBeNull();
    expect(phoneSearchDigits('12')).toBeNull();
  });
});
