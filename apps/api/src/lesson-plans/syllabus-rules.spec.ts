import { SyllabusStatus } from '@prisma/client';
import { parseTopicLines, syllabusProgress } from './syllabus-rules.js';

describe('syllabusProgress', () => {
  it('is zero for an empty syllabus', () => {
    expect(syllabusProgress([])).toEqual({ total: 0, done: 0, started: 0, percent: 0 });
  });
  it('counts only finished topics towards the percentage', () => {
    const p = syllabusProgress([{ status: SyllabusStatus.DONE }, { status: SyllabusStatus.IN_PROGRESS }, { status: SyllabusStatus.PENDING }, { status: SyllabusStatus.DONE }]);
    expect(p).toEqual({ total: 4, done: 2, started: 1, percent: 50 });
  });
});

describe('parseTopicLines', () => {
  it('drops numbering, bullets, blanks and repeats', () => {
    expect(parseTopicLines('1. Fractions\r\n- Decimals\n\n  3) fractions \n• Ratio')).toEqual(['Fractions', 'Decimals', 'Ratio']);
  });
});
