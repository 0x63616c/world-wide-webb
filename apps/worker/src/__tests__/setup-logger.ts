/**
 * Vitest setup: seed the process-wide @www/logger root so that getLogger()
 * never throws "called before createLogger" in unit tests (mirrors
 * apps/api/src/__tests__/setup-logger.ts). All output is suppressed
 * (level: "silent") , tests assert behavior, not log lines.
 */
import { createLogger } from "@www/logger";

createLogger({ service: "worker", level: "silent" });
