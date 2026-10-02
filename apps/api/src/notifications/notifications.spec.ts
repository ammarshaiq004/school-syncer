import { toInternational } from './phone.js';
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
