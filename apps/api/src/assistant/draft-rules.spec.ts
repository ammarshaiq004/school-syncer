import { draftPrompt, draftSchema, fit, REMARK_MAX, templateDraft, type DraftFacts } from './draft-rules.js';

const facts: DraftFacts = {
  student: { firstName: 'Ahmed', fullName: 'Ahmed Khan', className: 'Grade 5 A' },
  attendancePercent: 78,
  result: {
    exam: 'Mid-term',
    percent: 72.4,
    grade: 'B',
    position: 6,
    passed: true,
    subjects: [
      { subject: 'Maths', percent: 90, passed: true, absent: false },
      { subject: 'English', percent: 55, passed: true, absent: false },
      { subject: 'Science', percent: null, passed: false, absent: true },
    ],
  },
  overdueFees: null,
  schoolName: 'Demo School',
  writerName: 'Saima Bibi',
};

describe('draft rules', () => {
  it('writes a template remark from the result and attendance', () => {
    const text = templateDraft('report_remark', facts);
    expect(text).toContain('Ahmed has shown good performance in Mid-term with 72.4% overall.');
    expect(text).toContain('Strongest in Maths; English needs more practice.');
    expect(text).toContain('More regular attendance will help.');
    expect(text.length).toBeLessThanOrEqual(REMARK_MAX);
  });

  it('keeps remarks within the stored length', () => {
    const text = templateDraft('report_remark', facts, 'x '.repeat(400));
    expect(text.length).toBeLessThanOrEqual(REMARK_MAX);
    expect(fit('short', 10)).toBe('short');
    expect(fit('one two three four five', 12)).toBe('one two…');
  });

  it('signs a template parent message with the writer and school', () => {
    const text = templateDraft('parent_message', facts, 'He has missed homework this week');
    expect(text).toMatch(/^Assalam-o-Alaikum,/);
    expect(text).toContain('I am writing about Ahmed. He has missed homework this week.');
    expect(text.trim().endsWith('Saima Bibi\nDemo School')).toBe(true);
  });

  it('puts facts and notes in the prompt and asks for the language', () => {
    const req = draftSchema.parse({ kind: 'parent_message', studentId: 's1', notes: 'Well done', language: 'ur' });
    const prompt = draftPrompt(req, facts);
    expect(prompt).toContain('"fullName": "Ahmed Khan"');
    expect(prompt).toContain('<teacher_notes>\nWell done\n</teacher_notes>');
    expect(prompt).toContain('Urdu');
    expect(req.tone).toBe('warm');
  });
});
