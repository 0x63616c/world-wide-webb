/**
 * Vitest setup: seed the process-wide @repo/logger root so that getLogger()
 * never throws "called before createLogger" in unit tests. All output is
 * suppressed (level: "silent") , tests assert behaviour, not log lines.
 */
import { createLogger } from "@repo/logger";

// Seed once for the entire test process. Tests that need to inspect logger
// calls should pass a spy logger to the unit under test directly rather than
// overriding the global root here.
createLogger({ service: "api", level: "silent" });
