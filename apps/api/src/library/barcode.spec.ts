import { code128 } from './barcode.js';

// Reference outputs from the JsBarcode library (CODE128B).
const REFERENCE: Record<string, string> = {
  '1': '1101001000010011100110110011100101100011101011',
  'PJJ123C': '1101001000011101110110101101110001011011100010011100110110011100101100101110010001000110111010001101100011101011',
  'REF-12': '11010010000110001011101000110100010001100010100110111001001110011011001110010100110000101100011101011',
  'a~z {}': '11010010000100101100001000101111011011110110110110011001111011011010100011110101111010001100011101011',
};

describe('code128', () => {
  it.each(Object.entries(REFERENCE))('encodes %s like the reference', (text, modules) => {
    expect(code128(text)).toBe(modules);
  });

  it('starts with the start-B pattern and ends with the stop bar', () => {
    const m = code128('10042');
    expect(m.startsWith('11010010000')).toBe(true);
    expect(m.endsWith('1100011101011')).toBe(true);
  });

  it('rejects text it cannot carry', () => {
    expect(() => code128('')).toThrow(RangeError);
    expect(() => code128('کتاب')).toThrow(RangeError);
  });
});
