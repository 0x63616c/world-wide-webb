/**
 * Mock EmailSender (www-q002.9). The dev/test fallback when no real email
 * provider is configured: it logs the code via @repo/logger AND stores the last
 * code per email so dev tooling and the Playwright E2E suite can read it back
 * ("print the 6", Calum). NEVER selected in production: the router throws if no
 * real sender is configured there (www-q002.11 wires Resend). The store is
 * process-local and unbounded-by-design-small (one entry per email seen).
 */
import { getLogger } from "@repo/logger";
import type { EmailSender } from "./portal-service";

export interface MockEmailSender extends EmailSender {
  /** The last code sent to `email`, for dev/E2E readback. */
  lastCode(email: string): string | undefined;
}

export function createMockEmailSender(): MockEmailSender {
  const store = new Map<string, string>();
  // getLogger() resolved lazily at the log site, NOT at construction: this sender
  // is built as a module-level singleton in portal.ts (evaluated during import,
  // before server.ts's createLogger()). Eager getLogger() here would throw the
  // same "called before createLogger()" that crash-looped the api via the Resend
  // sender (www-q002.11). Dev-only path, but kept consistent + safe.
  return {
    async sendCode(email, code) {
      store.set(email, code);
      // Dev-readable: the code is intentionally logged so a developer/E2E run
      // can grab it. This sender is never used in production.
      getLogger().info({ email, code }, "portal MOCK email, verification code");
    },
    lastCode: (email) => store.get(email),
  };
}
