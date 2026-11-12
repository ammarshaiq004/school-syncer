/** The school's own WhatsApp number linked by QR (apps/api/src/notifications/whatsapp-link.service.ts). */
export type LinkState = "NOT_LINKED" | "WAITING_FOR_SCAN" | "CONNECTED";

export interface LinkView {
  serverReady: boolean;
  allowed: boolean;
  state: LinkState;
  number: string | null;
  profileName: string | null;
  qr: string | null;
}

export interface LinkTestResult {
  status: "SENT" | "FAILED";
  error: string | null;
}

/** 923001234567 -> "0300 1234567" for Pakistani mobiles; anything else as +digits. */
export function formatWhatsAppNumber(digits: string | null | undefined): string {
  if (!digits) return "";
  if (/^923\d{9}$/.test(digits)) return `0${digits.slice(2, 5)} ${digits.slice(5)}`;
  return `+${digits}`;
}

export const LINK_STATE_LABEL: Record<LinkState, string> = {
  CONNECTED: "Connected",
  WAITING_FOR_SCAN: "Waiting for the QR scan",
  NOT_LINKED: "Not linked",
};

/** How often the card asks again while a QR is on screen, so it moves on as soon as the phone scans it. */
export const LINK_POLL_MS = 3000;
export const pollsLink = (view: Pick<LinkView, "state"> | null) => view?.state === "WAITING_FOR_SCAN";
