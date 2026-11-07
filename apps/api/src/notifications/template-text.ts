import { TEMPLATES, type TemplateKey } from './templates.js';

/**
 * Messages a school may reword or switch off. The rest carry secrets
 * (invites, reset codes) or come from SchoolSyncer itself.
 */
export const EDITABLE_TEMPLATES = [
  'attendance.absent',
  'fees.voucher',
  'fees.reminder',
  'fees.paid',
  'exam.result',
  'homework.assigned',
] as const satisfies readonly TemplateKey[];
export type EditableTemplate = (typeof EDITABLE_TEMPLATES)[number];

export const TEMPLATE_LABELS: Record<EditableTemplate, string> = {
  'attendance.absent': 'Absence alert',
  'fees.voucher': 'Fee voucher',
  'fees.reminder': 'Fee reminder',
  'fees.paid': 'Payment receipt',
  'exam.result': 'Exam result',
  'homework.assigned': 'New homework',
};

export const MAX_TEMPLATE_LENGTH = 600;

export const isEditable = (key: string): key is EditableTemplate => (EDITABLE_TEMPLATES as readonly string[]).includes(key);

/** The {placeholders} a message can use. */
export const placeholders = (key: EditableTemplate): readonly string[] => TEMPLATES[key].params;

/** The built-in wording with {placeholders} left in, as the editor starts from. */
export function defaultText(key: EditableTemplate): string {
  const params = Object.fromEntries(TEMPLATES[key].params.map((p) => [p, `{${p}}`]));
  return (TEMPLATES[key].text as (p: Record<string, string>) => string)(params);
}

/** Problems with a school's wording; an empty list means it can be saved. */
export function templateProblems(key: EditableTemplate, body: string): string[] {
  const problems: string[] = [];
  if (body.length > MAX_TEMPLATE_LENGTH) problems.push(`Keep it under ${MAX_TEMPLATE_LENGTH} characters`);
  const allowed = new Set(placeholders(key));
  const unknown = [...new Set([...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((p) => !allowed.has(p)))];
  if (unknown.length) problems.push(`Unknown ${unknown.length === 1 ? 'placeholder' : 'placeholders'}: ${unknown.map((u) => `{${u}}`).join(', ')}`);
  return problems;
}

/** The school's wording for a message (a blank one means the built-in text). */
export interface TemplateOverride {
  body: string;
  enabled: boolean;
}

/** The text a recipient gets: the school's wording with placeholders filled in, else the built-in text. */
export function renderText(key: TemplateKey, params: Record<string, string>, override?: TemplateOverride | null): string {
  if (override?.body.trim() && isEditable(key)) {
    return override.body.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? params[name] : whole));
  }
  return (TEMPLATES[key].text as (p: Record<string, string>) => string)(params);
}
