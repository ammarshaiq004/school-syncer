const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 0-999 in words ("Four Hundred Five"); "" for 0. */
function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest >= 20) parts.push(TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${ONES[rest % 10]}` : ""));
  else if (rest) parts.push(ONES[rest]);
  return parts.join(" ");
}

/**
 * Whole rupees in words the way a Pakistani receipt writes them, with lakh
 * and crore: 1250000 is "Twelve Lakh Fifty Thousand".
 */
export function numberInWords(amount: number): string {
  let n = Math.floor(Math.abs(amount));
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  // Beyond 99 crore the crore count itself is spelled out the same way.
  if (crore) parts.push(`${numberInWords(crore)} Crore`);
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return (amount < 0 ? "Minus " : "") + parts.join(" ");
}

/** "Rupees Twelve Thousand Five Hundred Only". */
export const rupeesInWords = (amount: number) => `Rupees ${numberInWords(amount)} Only`;
