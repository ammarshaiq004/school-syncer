import { ConflictException } from '@nestjs/common';
import { assertUnused, inUseMessage } from './in-use.js';

describe('inUseMessage', () => {
  it('is null when nothing uses the record', () => {
    expect(inUseMessage('Grade 1', { section: 0, 'fee amount': 0 })).toBeNull();
  });

  it('lists what still uses it, with plurals', () => {
    expect(inUseMessage('Grade 1', { section: 2, 'fee amount': 1, 'live class': 3, quiz: 2, 'exam paper': 0 })).toBe(
      "Grade 1 is in use (2 sections, 1 fee amount, 3 live classes and 2 quizzes), so it can't be deleted. Remove or move those first, or rename it instead.",
    );
  });

  it('throws a 409 from assertUnused', () => {
    expect(() => assertUnused('Maths', { 'timetable slot': 1 })).toThrow(ConflictException);
    expect(() => assertUnused('Maths', { 'timetable slot': 0 })).not.toThrow();
  });
});
