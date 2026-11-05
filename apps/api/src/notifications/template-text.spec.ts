import { defaultText, EDITABLE_TEMPLATES, isEditable, renderText, templateProblems } from './template-text.js';
import { loggableText, TEMPLATES } from './templates.js';

const params = { studentName: 'Ahmed', date: '5 Nov', schoolName: 'Bright School' };

describe('message template wording', () => {
  it('shows the built-in text with placeholders for editing', () => {
    expect(defaultText('attendance.absent')).toBe('Dear parent, {studentName} was marked absent on {date}. - {schoolName}');
    for (const key of EDITABLE_TEMPLATES) expect(defaultText(key)).toContain('{schoolName}');
  });

  it('only lets non-secret school messages be edited', () => {
    expect(isEditable('fees.paid')).toBe(true);
    expect(isEditable('parent.invite')).toBe(false);
    expect(isEditable('password.reset')).toBe(false);
    expect(isEditable('platform.billing')).toBe(false);
  });

  it('fills the school wording with the message parameters', () => {
    const text = renderText('attendance.absent', params, { body: '{studentName} missed school on {date}.', enabled: true });
    expect(text).toBe('Ahmed missed school on 5 Nov.');
  });

  it('falls back to the built-in text when there is no wording', () => {
    const builtin = TEMPLATES['attendance.absent'].text(params);
    expect(renderText('attendance.absent', params)).toBe(builtin);
    expect(renderText('attendance.absent', params, { body: '  ', enabled: false })).toBe(builtin);
  });

  it('never applies wording to messages that cannot be edited', () => {
    const secret = { password: 'p', login: 'l', schoolCode: 'c', schoolName: 'S' };
    expect(renderText('parent.invite', secret, { body: 'hacked {password}', enabled: true })).toBe(TEMPLATES['parent.invite'].text(secret));
  });

  it('leaves unknown placeholders untouched', () => {
    expect(renderText('attendance.absent', params, { body: 'Hi {nobody}', enabled: true })).toBe('Hi {nobody}');
  });

  it('flags unknown placeholders and over-long wording', () => {
    expect(templateProblems('fees.paid', 'Rs {amount} for {studentName}')).toEqual([]);
    expect(templateProblems('fees.paid', 'Hi {password} {nope}')).toEqual(['Unknown placeholders: {password}, {nope}']);
    expect(templateProblems('fees.paid', 'x'.repeat(601))).toEqual(['Keep it under 600 characters']);
  });

  it('puts the school wording in the delivery log too', () => {
    expect(loggableText('attendance.absent', params, { body: 'Absent: {studentName}', enabled: true })).toBe('Absent: Ahmed');
  });
});
