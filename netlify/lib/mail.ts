// Sends the sign-in code through Resend (https://resend.com).
import type { SendCode } from './auth';

/** Resend's shared test sender: it can mail the address that owns the Resend account without verifying a domain. */
export const DEFAULT_FROM = 'keepMeUpdated <onboarding@resend.dev>';

export function codeEmail(code: string, site: string): { subject: string; text: string; html: string } {
  const subject = `${code} is your keepMeUpdated sign-in code`;
  const text = `Your sign-in code for the keepMeUpdated admin is ${code}.\n\nIt expires in 10 minutes. If you didn't ask for it, ignore this email.\n\n${site}`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#1a1a1a">
  <p style="margin:0 0 16px">Your sign-in code for the <strong>keepMeUpdated</strong> admin:</p>
  <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:8px;font-family:ui-monospace,monospace">${code}</p>
  <p style="margin:0;color:#555;font-size:14px">It expires in 10 minutes. If you didn't ask for it, ignore this email.</p>
</div>`;
  return { subject, text, html };
}

export function resendMailer(opts: { apiKey: string; from?: string; site: string; fetch?: typeof fetch }): SendCode {
  return async (to, code) => {
    const res = await (opts.fetch ?? fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: opts.from || DEFAULT_FROM, to: [to], ...codeEmail(code, opts.site) }),
    });
    if (!res.ok) throw new Error(`Resend returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  };
}
