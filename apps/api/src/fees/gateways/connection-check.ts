import { timingSafeEqual } from 'node:crypto';
import type { GatewayConfig } from './gateway-config.js';
import { easypaisaInquiryRequest, type EasypaisaInquiryResponse } from './easypaisa.js';
import { jazzcashHash, jazzcashInquiryRequest } from './jazzcash.js';
import { ONEBILL, type OnebillPaymentRequest } from './onebill.js';
import type { AccountProvider } from './school-accounts.js';

/**
 * "Test connection" for a merchant account (SCHOOL-149): one harmless call
 * that proves the credentials work without moving money.
 *
 * - JazzCash: Status Inquiry for a reference that was never used. A reply
 *   signed with our integrity salt proves the salt, and JazzCash only answers
 *   about the merchant once the merchant ID and password are accepted.
 * - Easypaisa: Inquire Transaction for a made-up order. "Order not found"
 *   proves the store ID, API username and password. The hash key is only used
 *   when a checkout starts, so a sandbox payment is what proves it.
 * - 1Bill: 1LINK calls us, so there is nothing to call. The check runs our own
 *   bill inquiry and bill payment handlers with the configured biller
 *   credentials, as 1LINK would, for a consumer number that does not exist.
 *
 * Nothing here logs or returns a secret: results carry the provider's code and
 * message only.
 */

export interface CheckStep {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface CheckVerdict {
  ok: boolean;
  /** The provider's own code (pp_ResponseCode, responseCode, response_Code) or "HTTP 401" and the like. */
  code: string | null;
  /** The provider's message, trimmed. */
  message: string | null;
  /** What it means and what to do, in plain words. */
  hint: string;
  steps: CheckStep[];
}

/** A reference no checkout ever uses: checkouts start with "T" and a timestamp, probes with "TCHK". */
export const probeRef = (now: Date) => `TCHK${now.getTime().toString(36).toUpperCase()}`.slice(0, 20);

const trim = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);

/**
 * JazzCash codes that mean the merchant was not accepted. From JazzCash's
 * response code list (confirm against the sheet JazzCash sends with the
 * account, see docs/gateway-go-live.md); anything else on a correctly signed
 * reply (including "transaction not found") means the credentials were accepted.
 */
export const JAZZCASH_CREDENTIAL_CODES: Record<string, string> = {
  '101': 'JazzCash did not accept the merchant ID or password.',
  '115': 'JazzCash says the secure hash is wrong: the integrity salt does not belong to this merchant ID.',
};

/** Reads JazzCash's answer to a Status Inquiry probe. */
export function jazzcashProbeVerdict(c: GatewayConfig, body: unknown): CheckVerdict {
  if (!body || typeof body !== 'object') {
    return { ok: false, code: null, message: null, hint: 'JazzCash answered with something that is not JSON. Check JAZZCASH_INQUIRY_URL.', steps: [] };
  }
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (typeof v === 'string') fields[k] = v;
  const code = trim(fields.pp_ResponseCode);
  const message = trim(fields.pp_ResponseMessage);
  const given = (fields.pp_SecureHash ?? '').toUpperCase();
  const expected = jazzcashHash(fields, c.jazzcash.integritySalt);
  const signed = given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  const steps: CheckStep[] = [
    { label: 'JazzCash answered', ok: true, detail: code ? `Code ${code}` : undefined },
    { label: 'Reply signed with your integrity salt', ok: signed },
  ];
  if (code && JAZZCASH_CREDENTIAL_CODES[code]) {
    steps.push({ label: 'Merchant ID and password accepted', ok: false });
    return {
      ok: false,
      code,
      message,
      hint: `${JAZZCASH_CREDENTIAL_CODES[code]} Copy them again from the JazzCash merchant portal; sandbox and live accounts have different credentials.`,
      steps,
    };
  }
  if (!signed) {
    return {
      ok: false,
      code,
      message,
      hint: given
        ? "JazzCash answered, but its signature does not match your integrity salt. Copy the integrity salt again from the merchant portal (no spaces), and make sure it belongs to this merchant ID."
        : 'JazzCash answered without a signature, which usually means it refused the request before checking the account. Check the merchant ID and password, and read the message from JazzCash.',
      steps,
    };
  }
  steps.push({ label: 'Merchant ID and password accepted', ok: true });
  return {
    ok: true,
    code,
    message,
    hint: 'JazzCash accepted the merchant ID and password and signed its reply with your integrity salt. A payment in this mode will be verified correctly.',
    steps,
  };
}

/** Easypaisa codes that a made-up order may get when the credentials are right. */
const EASYPAISA_OK = new Set(['0000', '0003']);
/** Plain-language meanings from Easypaisa's Inquire Transaction code list. */
export const EASYPAISA_HINTS: Record<string, string> = {
  '0001': 'Easypaisa had a system error. Try again in a few minutes; if it keeps happening, contact Easypaisa.',
  '0002': 'Easypaisa says a required field is missing. Check the store ID and account number.',
  '0004': 'Easypaisa does not know this merchant account. Check the account number (or leave it empty) and that the account exists in this environment.',
  '0005': 'The merchant account is not active yet. Ask Easypaisa to activate it for this environment.',
  '0006': 'Easypaisa does not know this store ID. Copy it again from the Easypaisa merchant portal.',
  '0007': 'The store is not active yet. Ask Easypaisa to activate it for this environment.',
};

/** Reads Easypaisa's answer to an Inquire Transaction probe. */
export function easypaisaProbeVerdict(c: GatewayConfig, body: unknown): CheckVerdict {
  const hashKeyOk = c.easypaisa.hashKey.length === 16;
  const hashStep: CheckStep = {
    label: 'Hash key looks right',
    ok: hashKeyOk,
    detail: hashKeyOk ? 'Only a checkout uses it, so a sandbox payment proves it' : 'It must be exactly 16 characters',
  };
  if (!body || typeof body !== 'object') {
    return { ok: false, code: null, message: null, hint: 'Easypaisa answered with something that is not JSON. Check EASYPAISA_BASE_URL.', steps: [hashStep] };
  }
  const r = body as EasypaisaInquiryResponse;
  const code = trim(r.responseCode);
  const message = trim(r.responseDesc);
  const accepted = code !== null && EASYPAISA_OK.has(code);
  const steps: CheckStep[] = [
    { label: 'Easypaisa answered', ok: true, detail: code ? `Code ${code}` : undefined },
    { label: 'Store ID, API username and password accepted', ok: accepted },
    hashStep,
  ];
  if (!accepted) {
    return {
      ok: false,
      code,
      message,
      hint:
        (code && EASYPAISA_HINTS[code]) ??
        'Easypaisa refused the inquiry. Check the API username and password (they are not the merchant portal login) and the store ID.',
      steps,
    };
  }
  return {
    ok: hashKeyOk,
    code,
    message,
    hint: hashKeyOk
      ? 'Easypaisa accepted the store ID, API username and password. Easypaisa payments in this mode can be confirmed.'
      : 'Easypaisa accepted the API credentials, but the hash key must be exactly 16 characters or checkouts will be refused.',
    steps,
  };
}

/** Why an HTTP call to a gateway failed, in plain words. */
export function httpFailure(provider: 'JazzCash' | 'Easypaisa', status: number): CheckVerdict {
  const hint =
    status === 401 || status === 403
      ? `${provider} refused the connection. Check the credentials; some accounts also need this server's IP address allow-listed by ${provider}.`
      : status === 404
        ? `${provider} has no API at this address. Check the URL override in the environment, or remove it to use the standard one.`
        : status >= 500
          ? `${provider} had a problem on its side. Try again in a few minutes.`
          : `${provider} did not accept the request.`;
  return { ok: false, code: `HTTP ${status}`, message: null, hint, steps: [{ label: `${provider} answered`, ok: false, detail: `HTTP ${status}` }] };
}

/** A gateway that could not be reached at all. */
export function unreachable(provider: 'JazzCash' | 'Easypaisa', url: string, error: Error): CheckVerdict {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url || 'its API';
    }
  })();
  const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
  return {
    ok: false,
    code: timeout ? 'TIMEOUT' : 'NETWORK',
    message: null,
    hint: timeout
      ? `${provider} (${host}) did not answer within 15 seconds. Try again; if it keeps happening, check the server's internet access.`
      : `Could not reach ${provider} at ${host}. Check the server's internet access and DNS.`,
    steps: [{ label: `${provider} answered`, ok: false }],
  };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

async function post(fetchImpl: Fetch, req: { url: string; headers: Record<string, string>; body: unknown }) {
  return fetchImpl(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal: AbortSignal.timeout(15_000),
  });
}

export async function checkJazzcash(c: GatewayConfig, fetchImpl: Fetch, now = new Date()): Promise<CheckVerdict> {
  const req = jazzcashInquiryRequest(c, probeRef(now));
  let res: Response;
  try {
    res = await post(fetchImpl, req);
  } catch (error) {
    return unreachable('JazzCash', req.url, error as Error);
  }
  if (!res.ok) return httpFailure('JazzCash', res.status);
  return jazzcashProbeVerdict(c, await res.json().catch(() => null));
}

export async function checkEasypaisa(c: GatewayConfig, fetchImpl: Fetch, now = new Date()): Promise<CheckVerdict> {
  const req = easypaisaInquiryRequest(c, probeRef(now));
  let res: Response;
  try {
    res = await post(fetchImpl, req);
  } catch (error) {
    return unreachable('Easypaisa', req.url, error as Error);
  }
  if (!res.ok) return httpFailure('Easypaisa', res.status);
  return easypaisaProbeVerdict(c, await res.json().catch(() => null));
}

/** Our own 1LINK handlers, called in-process exactly as the routes call them. */
export interface OnebillHandlers {
  authorised(consumerNumber: string, username: string, password: string): Promise<boolean>;
  inquiry(consumerNumber: string): Promise<{ response_Code: string }>;
  payment(req: OnebillPaymentRequest): Promise<{ response_Code: string }>;
}

/**
 * The 1Bill self-test: the biller credentials get in, a wrong password does
 * not, and an unknown consumer number is answered "not found" by both bill
 * inquiry and bill payment (so nothing is paid). `problems` are reasons 1LINK
 * could not reach the callback addresses (see goLiveProblems).
 */
export async function checkOnebill(c: GatewayConfig, handlers: OnebillHandlers, problems: string[]): Promise<CheckVerdict> {
  // Ten nines after the prefix: random consumer numbers could only clash once in ten billion.
  const probe = `${c.onebill.billerPrefix}9999999999`;
  const { username, password } = c.onebill;
  const steps: CheckStep[] = [];
  const accepted = await handlers.authorised(probe, username, password);
  steps.push({ label: 'Biller username and password accepted by our 1LINK endpoints', ok: accepted });
  const wrongRefused = !(await handlers.authorised(probe, username, `${password}#wrong`));
  steps.push({ label: 'A wrong password is refused', ok: wrongRefused });
  const inquiry = await handlers.inquiry(probe);
  const inquiryOk = inquiry.response_Code === ONEBILL.NOT_FOUND;
  steps.push({ label: 'Bill inquiry answers an unknown number with "not found"', ok: inquiryOk, detail: `response_Code ${inquiry.response_Code}` });
  const payment = await handlers.payment({
    consumer_number: probe,
    tran_auth_id: '000000',
    transaction_amount: '000000001000',
    tran_date: '',
    tran_time: '',
    bank_mnemonic: 'SELFTEST',
  });
  const paymentOk = payment.response_Code === ONEBILL.NOT_FOUND;
  steps.push({ label: 'Bill payment refuses an unknown number', ok: paymentOk, detail: `response_Code ${payment.response_Code}` });
  steps.push({
    label: '1LINK can reach the callback addresses',
    ok: problems.length === 0,
    detail: problems[0],
  });
  const ok = accepted && wrongRefused && inquiryOk && paymentOk && problems.length === 0;
  const code = !inquiryOk ? inquiry.response_Code : !paymentOk ? payment.response_Code : null;
  const hint = !accepted
    ? 'Our 1LINK endpoints did not accept the saved biller credentials for this prefix. Check the biller prefix, and that 1Bill is switched on.'
    : !wrongRefused
      ? 'A wrong password was accepted. Contact SchoolSyncer support before going live.'
      : !inquiryOk || !paymentOk
        ? `A probe consumer number under this prefix exists already (response ${code}). Contact SchoolSyncer support.`
        : problems.length
          ? `The handlers work, but 1LINK cannot call them yet: ${problems[0]}`
          : 'The bill inquiry and bill payment handlers accept these credentials. Give 1LINK the addresses and username below, and the password you saved.';
  return { ok, code, message: null, hint, steps };
}

/** Mock mode: nothing is called, the check passes as if the gateway answered. */
export function simulatedVerdict(provider: AccountProvider): CheckVerdict {
  const name = { JAZZCASH: 'JazzCash', EASYPAISA: 'Easypaisa', ONEBILL: '1Bill' }[provider];
  return {
    ok: true,
    code: null,
    message: null,
    hint: `Payments are in mock mode, so ${name} was not called. Switch the server to sandbox to test the real credentials.`,
    steps: [{ label: 'Simulated pass (mock mode)', ok: true }],
  };
}
