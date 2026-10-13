import { bFormField, cnicField, formatCnic, nameKey, normalizeCnic, normalizePhone, phoneField, sameName } from './identity.js';

describe('normalizePhone', () => {
  it.each([
    '03001234567',
    '0300 1234567',
    '0300-1234567',
    '0300-123-4567',
    '(0300) 1234567',
    '0300.1234567',
    '+923001234567',
    '+92 300 1234567',
    '+92-300-1234567',
    '+92 0300 1234567',
    '923001234567',
    '92 300 1234567',
    '00923001234567',
    '0092 300 1234567',
    '3001234567',
    '300 1234567',
    '  0300 1234567  ',
  ])('reads %s as 03001234567', (typed) => {
    expect(normalizePhone(typed)).toBe('03001234567');
  });

  it.each([
    '042-35761234', // landline
    '0300123456', // one digit short
    '030012345678', // one digit long
    '04001234567', // not a mobile prefix
    '+1 300 1234567',
    '0300-12345x7',
    '0300+1234567',
    '',
    '92300',
  ])('refuses %s', (typed) => {
    expect(normalizePhone(typed)).toBeUndefined();
  });
});

describe('normalizeCnic', () => {
  it.each(['3520212345671', '35202-1234567-1', '35202 1234567 1', ' 35202-1234567-1 ', '35202 - 1234567 - 1'])(
    'reads %s as 13 digits',
    (typed) => {
      expect(normalizeCnic(typed)).toBe('3520212345671');
    },
  );

  it.each(['35202-123456-1', '352021234567', '35202123456712', 'B-3520212345671', '35202/1234567/1', ''])('refuses %s', (typed) => {
    expect(normalizeCnic(typed)).toBeUndefined();
  });

  it('formats stored CNICs for display and leaves anything else alone', () => {
    expect(formatCnic('3520212345671')).toBe('35202-1234567-1');
    expect(formatCnic('legacy value')).toBe('legacy value');
  });
});

describe('zod fields', () => {
  it('store the canonical form and explain what is wrong', () => {
    expect(phoneField.parse('+92 300 1234567')).toBe('03001234567');
    expect(cnicField.parse('35202-1234567-1')).toBe('3520212345671');
    expect(bFormField.parse('35202 1234567 1')).toBe('3520212345671');
    expect(phoneField.safeParse('042 35761234').error?.issues[0].message).toMatch(/mobile number like 0300 1234567/);
    expect(cnicField.safeParse('123').error?.issues[0].message).toMatch(/CNIC should be 13 digits/);
    expect(bFormField.safeParse('123').error?.issues[0].message).toMatch(/B-Form number should be 13 digits/);
  });
});

describe('sameName', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(sameName('Muhammad  Imran', 'muhammad imran')).toBe(true);
    expect(sameName('M. Imran', 'M Imran')).toBe(true);
    expect(sameName('Imran Khan', 'Ayesha Bibi')).toBe(false);
    expect(nameKey(' Ali-Raza ')).toBe('ali raza');
  });
});
