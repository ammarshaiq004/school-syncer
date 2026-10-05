/** One student's sign-in details for a printed slip. password null = unchanged (not shown). */
export interface LoginSlip {
  name: string;
  admissionNo: string;
  rollNo: number | null;
  username: string;
  password: string | null;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Opens a print-ready page of cut-out login slips (one per student) and the print dialog.
 * Built as a standalone document so the app chrome and dialogs never end up on paper.
 * Returns false when the browser blocked the new window.
 */
export function printLoginSlips({
  schoolName,
  schoolCode,
  title,
  slips,
}: {
  schoolName: string;
  schoolCode: string;
  title: string;
  slips: LoginSlip[];
}): boolean {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return false;
  const signIn = `${window.location.origin}/login`;
  const cards = slips
    .map(
      (s) => `
      <div class="slip">
        <div class="school">${esc(schoolName)}</div>
        <div class="name">${esc(s.name)}${s.rollNo != null ? ` <span class="muted">(roll ${s.rollNo})</span>` : ""}</div>
        <table>
          <tr><th>Sign in at</th><td>${esc(signIn)}</td></tr>
          <tr><th>School code</th><td class="mono">${esc(schoolCode)}</td></tr>
          <tr><th>Username</th><td class="mono">${esc(s.username)}</td></tr>
          <tr><th>Password</th><td class="mono">${s.password ? esc(s.password) : '<span class="muted">Unchanged</span>'}</td></tr>
        </table>
        <div class="note">Keep this slip safe. Change your password after you first sign in.</div>
      </div>`,
    )
    .join("");
  win.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; margin: 24px; font-size: 13px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.lead { margin: 0 0 16px; color: #475569; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .slip { border: 1px dashed #94a3b8; border-radius: 8px; padding: 12px 14px; break-inside: avoid; }
  .school { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; }
  .name { font-weight: 600; font-size: 14px; margin: 2px 0 8px; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; font-weight: 500; color: #64748b; padding: 2px 8px 2px 0; width: 96px; vertical-align: top; }
  td { padding: 2px 0; word-break: break-all; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 14px; font-weight: 600; }
  .muted { color: #64748b; font-weight: 400; font-family: inherit; font-size: 12px; }
  .note { margin-top: 8px; font-size: 11px; color: #64748b; }
  @media print { body { margin: 10mm; } .noprint { display: none; } }
</style></head><body>
  <h1>${esc(title)}</h1>
  <p class="lead">${esc(schoolName)}. Cut along the dashed lines and hand each student their slip.</p>
  <div class="grid">${cards}</div>
  <script>window.onload = function () { window.focus(); window.print(); };</script>
</body></html>`);
  win.document.close();
  return true;
}
