/**
 * Vitest setup: seed the process-wide @www/logger root so that getLogger()
 * never throws "called before createLogger" in unit tests that exercise
 * @www/core clients and adapters. All
 * output is suppressed (level: "silent") , tests assert behavior, not log lines.
 */
import { createLogger } from "@www/logger";

createLogger({ service: "core", level: "silent" });
