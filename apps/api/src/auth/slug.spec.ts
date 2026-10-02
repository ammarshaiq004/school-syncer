import { slugify } from './slug.js';

describe('slugify', () => {
  it('lowercases and joins words with dashes', () => {
    expect(slugify('The City School, Lahore')).toBe('the-city-school-lahore');
  });

  it('drops characters outside a-z and 0-9', () => {
    expect(slugify('  Al-Huda   School #2 ')).toBe('al-huda-school-2');
  });
});
