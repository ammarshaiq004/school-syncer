import { z } from 'zod';

/**
 * Drafts (SCHOOL-106): report card remarks and messages to parents. Claude
 * writes them when the server has an API key; otherwise a template built from
 * the same facts does, so the feature still works in the demo and in CI.
 */

export const DRAFT_KINDS = ['report_remark', 'parent_message'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const draftSchema = z.object({
  kind: z.enum(DRAFT_KINDS),
  studentId: z.string().min(1),
  /** Report remark: the exam whose result the remark is for (default: latest published). */
  examId: z.string().min(1).optional(),
  /** What the teacher wants to say, in their own words. */
  notes: z.string().trim().max(1000).optional(),
  tone: z.enum(['warm', 'neutral', 'firm']).default('warm'),
  language: z.enum(['en', 'ur']).default('en'),
});
export type DraftRequest = z.infer<typeof draftSchema>;

/** What a draft is written from: no contact details, no medical notes. */
export interface DraftFacts {
  student: { firstName: string; fullName: string; className: string | null };
  attendancePercent: number | null;
  result: {
    exam: string;
    percent: number;
    grade: string;
    position: number;
    passed: boolean;
    subjects: { subject: string; percent: number | null; passed: boolean; absent: boolean }[];
  } | null;
  /** Only when the writer may see fees. */
  overdueFees: number | null;
  schoolName: string;
  writerName: string;
}

/** Report remarks must fit ExamResult.teacherRemark (300 characters). */
export const REMARK_MAX = 300;

/** The template draft used when no model is configured. English only. */
export function templateDraft(kind: DraftKind, facts: DraftFacts, notes?: string): string {
  return kind === 'report_remark' ? templateRemark(facts, notes) : templateMessage(facts, notes);
}

function templateRemark(f: DraftFacts, notes?: string): string {
  const name = f.student.firstName;
  const parts: string[] = [];
  if (f.result) {
    const p = f.result.percent;
    const word = p >= 85 ? 'excellent' : p >= 70 ? 'good' : p >= 50 ? 'satisfactory' : 'weak';
    parts.push(`${name} has shown ${word} performance in ${f.result.exam} with ${round(p)}% overall.`);
    const scored = f.result.subjects.filter((s) => s.percent !== null) as { subject: string; percent: number }[];
    if (scored.length >= 2) {
      const best = scored.reduce((a, b) => (b.percent > a.percent ? b : a));
      const worst = scored.reduce((a, b) => (b.percent < a.percent ? b : a));
      if (best.subject !== worst.subject)
        parts.push(`Strongest in ${best.subject}; ${worst.subject} needs more practice.`);
    }
  } else {
    parts.push(`${name} is progressing this term.`);
  }
  if (f.attendancePercent !== null && f.attendancePercent < 85)
    parts.push('More regular attendance will help.');
  if (notes) parts.push(sentence(notes));
  return fit(parts.join(' '), REMARK_MAX);
}

function templateMessage(f: DraftFacts, notes?: string): string {
  const lines = [`Assalam-o-Alaikum,`, ''];
  const name = f.student.firstName;
  lines.push(
    notes
      ? `I am writing about ${name}. ${sentence(notes)}`
      : `I am writing to share an update about ${name}${f.student.className ? ` (${f.student.className})` : ''}.`,
  );
  const facts: string[] = [];
  if (f.attendancePercent !== null) facts.push(`attendance over the last 30 days is ${f.attendancePercent}%`);
  if (f.result) facts.push(`${name} scored ${round(f.result.percent)}% in ${f.result.exam}`);
  if (facts.length) lines.push(`For your information, ${facts.join(' and ')}.`);
  lines.push('', 'Please feel free to reply here if you would like to discuss.', '', `Regards,`, f.writerName, f.schoolName);
  return lines.join('\n');
}

export const DRAFT_SYSTEM = `You help teachers at a school in Pakistan write short, kind, specific text about one student.
Write only the requested text: no preamble, no headings, no placeholders, no markdown.
Use only the facts provided; never invent marks, events or diagnoses. Mention fees only if the teacher's notes ask for it.
Report card remarks are at most two sentences and ${REMARK_MAX} characters, written in the third person.
Messages to parents start with a greeting, stay under 120 words and end with the writer's name and the school's name.`;

/** The user turn for a draft: facts as JSON, then the ask. */
export function draftPrompt(req: DraftRequest, facts: DraftFacts): string {
  const what =
    req.kind === 'report_remark'
      ? 'Write the class teacher\'s report card remark for this student.'
      : 'Write a message from the teacher to this student\'s parent.';
  const lang = req.language === 'ur' ? 'Write it in Urdu (Urdu script).' : 'Write it in English.';
  return [
    `<facts>\n${JSON.stringify(facts, null, 2)}\n</facts>`,
    req.notes ? `<teacher_notes>\n${req.notes}\n</teacher_notes>` : '',
    `${what} Tone: ${req.tone}. ${lang}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Trims to the limit at a word boundary. */
export function fit(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '')}…`;
}

const sentence = (s: string) => {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};
const round = (n: number) => Math.round(n * 10) / 10;
