/**
 * Resend EmailSender for the captive portal (CC-q002.11). Sends the 6-digit
 * verification code via the Resend HTTP API behind the same EmailSender
 * interface as the mock, so the router swaps senders with config alone. Throws
 * on any non-ok response or network failure, a guest who never receives a code
 * must never be told it was sent (services throw, never fake success).
 *
 * Copy follows the portal's UI voice ("confirm it's you"); per PRD flow rule 8
 * it never names the SSID or uses the word "guest" in user-facing text.
 */
import { getLogger } from "@repo/logger";
import type { EmailSender } from "./portal-service";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TIMEOUT_MS = 10_000;

export interface ResendConfig {
  /** Resend API key (op://Homelab/Resend/credential). */
  apiKey: string;
  /** Verified from-address (op://Homelab/Resend/from-address). */
  from: string;
}

function subject(code: string): string {
  return `${code} is your World Wide Webb code`;
}

function textBody(code: string): string {
  return [
    "Enter this code to confirm it's you and get online:",
    "",
    code,
    "",
    "This code expires in 10 minutes. If you didn't request it, you can ignore this email.",
  ].join("\n");
}

function htmlBody(code: string): string {
  // Minimal, inline-styled HTML, email clients ignore external CSS. Pure black
  // background to match the portal; the code is the focal element.
  return `<!doctype html><html><body style="margin:0;background:#000;color:#fff;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<div style="max-width:420px;text-align:left">
<p style="font-size:16px;line-height:1.5;color:#e5e5e5;margin:0 0 24px">Enter this code to confirm it's you and get online:</p>
<div style="font-size:40px;letter-spacing:10px;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin:0 0 24px">${code}</div>
<p style="font-size:13px;line-height:1.5;color:#9a9a9a;margin:0">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
</div></td></tr></table></body></html>`;
}

export function createResendEmailSender(config: ResendConfig): EmailSender {
  // getLogger() is resolved lazily at the log site, NOT here: this sender is
  // constructed as a module-level singleton in portal.ts, which evaluates during
  // import, before server.ts calls createLogger() at startup. Calling getLogger()
  // at construction threw "getLogger() called before createLogger()" and crash-
  // looped the api (CC-q002.11 regression that took the dashboard down). By the
  // time sendCode runs (request time) the root logger is initialised.
  return {
    async sendCode(email, code) {
      let res: Response;
      try {
        res = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: config.from,
            to: [email],
            subject: subject(code),
            text: textBody(code),
            html: htmlBody(code),
          }),
          signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        });
      } catch (err) {
        throw new Error(`Resend request failed: ${(err as Error).message}`);
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Resend returned ${res.status}: ${detail}`);
      }
      // Never log the code (unlike the mock): the real channel must not leak it.
      getLogger().info({ email }, "portal verification code emailed via Resend");
    },
  };
}
