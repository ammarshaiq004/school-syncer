/**
 * Message templates. For WhatsApp, business-initiated messages must use a
 * template approved in Meta Business Manager with the same name and the
 * parameters in this order; the text here is what SMS and logs carry.
 */
export const TEMPLATES = {
  'attendance.absent': {
    whatsapp: 'attendance_absent',
    params: ['studentName', 'date', 'schoolName'],
    text: (p: Record<string, string>) =>
      `Dear parent, ${p.studentName} was marked absent on ${p.date}. - ${p.schoolName}`,
  },
  'fees.voucher': {
    whatsapp: 'fee_voucher',
    params: ['studentName', 'period', 'amount', 'dueDate', 'voucherNo', 'schoolName'],
    text: (p: Record<string, string>) =>
      `Fee voucher for ${p.studentName} (${p.period}): Rs ${p.amount}, due ${p.dueDate}. Voucher ${p.voucherNo}. - ${p.schoolName}`,
  },
  'fees.reminder': {
    whatsapp: 'fee_reminder',
    params: ['studentName', 'period', 'amount', 'schoolName'],
    text: (p: Record<string, string>) =>
      `Reminder: Rs ${p.amount} fee for ${p.studentName} (${p.period}) is still unpaid. - ${p.schoolName}`,
  },
  'fees.paid': {
    whatsapp: 'fee_paid',
    params: ['amount', 'studentName', 'receiptNo', 'schoolName'],
    text: (p: Record<string, string>) =>
      `Received Rs ${p.amount} for ${p.studentName}. Receipt ${p.receiptNo}. Thank you. - ${p.schoolName}`,
  },
  'parent.invite': {
    whatsapp: 'parent_invite',
    params: ['schoolName', 'schoolCode', 'login', 'password'],
    secret: ['password'],
    text: (p: Record<string, string>) =>
      `${p.schoolName} parent portal: school code ${p.schoolCode}, login ${p.login}, password ${p.password}`,
  },
  announcement: {
    whatsapp: 'school_announcement',
    params: ['schoolName', 'title', 'body'],
    text: (p: Record<string, string>) => `${p.schoolName}: ${p.title}\n${p.body}`,
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

/** The message text with secret parameters (passwords) masked, for the delivery log. */
export function loggableText(key: TemplateKey, params: Record<string, string>): string {
  const template = TEMPLATES[key];
  const secret: readonly string[] = 'secret' in template ? template.secret : [];
  const masked = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, secret.includes(k) ? '********' : v]),
  );
  return template.text(masked);
}
