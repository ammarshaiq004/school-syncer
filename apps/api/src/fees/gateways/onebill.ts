import { timingSafeEqual } from 'node:crypto';
import type { GatewayConfig } from './gateway-config.js';

/**
 * 1Bill (1LINK bill payment). The school is a biller: when a parent enters
 * the consumer number in any banking or wallet app, 1LINK calls our
 * BillInquiry endpoint for the amount, then BillPayment once the money is
 * taken. Both calls carry the biller's username and password in headers.
 *
 * Amounts in an inquiry response are "+" and 13 digits with two implied
 * decimals ("+0000000150000" is Rs 1,500); in a payment request they are 12
 * digits, also in paisa.
 */

export const ONEBILL = {
  OK: '00',
  NOT_FOUND: '01',
  BLOCKED: '02',
  UNKNOWN_ERROR: '03',
  INVALID_DATA: '04',
  SERVICE_FAIL: '05',
} as const;

/** A consumer number: the biller prefix and 10 more digits, unique per checkout. */
export function onebillConsumerNumber(prefix: string, random: () => number): string {
  let digits = '';
  for (let i = 0; i < 10; i++) digits += Math.floor(random() * 10);
  return `${prefix}${digits}`;
}

export const onebillAmount = (rupees: number) => `+${String(Math.round(rupees * 100)).padStart(13, '0')}`;

/** True when a 1LINK call carries this biller's credentials. */
export function onebillAuthorised(c: GatewayConfig, username?: string, password?: string): boolean {
  const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  return Boolean(username && password && same(username, c.onebill.username) && same(password, c.onebill.password));
}

export interface OnebillBill {
  consumerNumber: string;
  studentName: string;
  amount: number;
  status: 'U' | 'P' | 'B';
  dueDate: Date;
  billingMonth: string; // "2026-10"
  paidOn?: Date | null;
  amountPaid?: number;
  authId?: string | null;
}

/** "YYYYMMDD" in Pakistan time. */
const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }).replaceAll('-', '');

export function onebillInquiryResponse(bill: OnebillBill | null, code: string = bill ? ONEBILL.OK : ONEBILL.NOT_FOUND) {
  if (!bill || code !== ONEBILL.OK) return { response_Code: code, reserved: '' };
  const month = /^\d{4}-\d{2}$/.test(bill.billingMonth) ? bill.billingMonth.slice(2).replace('-', '') : '';
  return {
    response_Code: ONEBILL.OK,
    consumer_Detail: bill.studentName.slice(0, 30).padEnd(30, ' '),
    bill_status: bill.status,
    due_date: ymd(bill.dueDate),
    amount_within_dueDate: onebillAmount(bill.amount),
    amount_after_dueDate: onebillAmount(bill.amount),
    billing_month: month,
    date_paid: bill.paidOn ? ymd(bill.paidOn) : '',
    amount_paid: bill.amountPaid ? String(Math.round(bill.amountPaid * 100)).padStart(12, '0') : '',
    tran_auth_Id: bill.authId ?? '',
    reserved: '',
  };
}

export interface OnebillPaymentRequest {
  consumer_number?: string;
  tran_auth_id?: string;
  transaction_amount?: string;
  tran_date?: string;
  tran_time?: string;
  bank_mnemonic?: string;
  reserved?: string;
}

/** Rupees from a 1LINK amount field, or null if it isn't one. */
export function onebillRupees(value: string | undefined): number | null {
  if (!value || !/^\+?\d{1,14}$/.test(value)) return null;
  return Number(value.replace('+', '')) / 100;
}
