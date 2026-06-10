/**
 * Mock EmailSender (CC-q002.9). The dev/test fallback when no real email
 * provider is configured: it logs the code via @repo/logger AND stores the last
 * code per email so dev tooling and the Playwright E2E suite can read it back
 * ("print the 6" — Calum). NEVER selected in production: the router throws if no
 * real sender is configured there (CC-q002.11 wires Resend). The store is
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
  const log = getLogger();
  return {
    async sendCode(email, code) {
      store.set(email, code);
      // Dev-readable: the code is intentionally logged so a developer/E2E run
      // can grab it. This sender is never used in production.
      log.info({ email, code }, "portal MOCK email — verification code");
    },
    lastCode: (email) => store.get(email),
  };
}
