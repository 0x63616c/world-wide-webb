/**
 * Automatic capture sources , the entries nobody had to remember to write.
 *
 * These matter more than the explicit `log.*` calls sprinkled through the app,
 * because the bug you are chasing is by definition the one you did not
 * anticipate. Patching console and installing the global error handlers costs
 * nothing and catches:
 *
 *   - every console.* the app already makes (TileBoundary, TeslaMap)
 *   - React's own warnings (key warnings, hydration complaints, act() errors)
 *   - uncaught exceptions and unhandled promise rejections, with stack traces
 *
 * The console patch forwards to the original methods, so devtools behaviour is
 * unchanged for anyone who does have a console open.
 */

import { log } from "./logger";
import type { LogLevel } from "./types";

let installed = false;

const CONSOLE_METHODS = {
  debug: "debug",
  log: "info",
  info: "info",
  warn: "warn",
  error: "error",
} as const satisfies Record<string, LogLevel>;

/** Render console varargs into a message + structured rest. */
function formatArgs(args: unknown[]): { msg: string; data?: unknown } {
  const [first, ...rest] = args;
  const msg =
    typeof first === "string" ? first : first instanceof Error ? first.message : String(first);
  if (first instanceof Error) {
    return { msg, data: { stack: first.stack, rest: rest.length ? rest : undefined } };
  }
  if (rest.length === 0) return { msg };
  return { msg, data: rest };
}

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { value: String(err) };
}

/**
 * Install the automatic sources. Idempotent, and safe to call before render , it
 * must run as early as possible in boot, since anything logged before it is
 * installed is lost for good.
 */
export function installCapture(): void {
  if (installed) return;
  installed = true;

  const consoleLog = log.child("console");
  for (const [method, level] of Object.entries(CONSOLE_METHODS) as [
    keyof typeof CONSOLE_METHODS,
    LogLevel,
  ][]) {
    // biome-ignore lint/suspicious/noConsole: patching console IS this module's job , the point is to capture the console calls the rest of the app (and React) makes, and to keep forwarding them to the real console.
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const { msg, data } = formatArgs(args);
      consoleLog[level](msg, data);
      original(...args);
    };
  }

  const errorLog = log.child("error");

  window.addEventListener("error", (event) => {
    // Resource load failures (a broken <img>) surface here with no `error`; they
    // are worth a line but are not crashes.
    if (!event.error && event.target && event.target !== window) {
      errorLog.warn("resource failed to load", {
        tag: (event.target as HTMLElement).tagName,
        src: (event.target as HTMLImageElement).src,
      });
      return;
    }
    errorLog.error(event.message || "uncaught error", {
      ...(serializeError(event.error) as object),
      source: event.filename,
      line: event.lineno,
      col: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    errorLog.error("unhandled promise rejection", serializeError(event.reason));
  });

  // Connectivity transitions. On a wall panel that cannot be inspected, "the wifi
  // dropped for 40 seconds at 3am" is otherwise indistinguishable from "the api
  // broke", and they call for completely different fixes.
  const netLog = log.child("net");
  netLog.info(`online: ${navigator.onLine}`);
  window.addEventListener("offline", () => netLog.error("went offline"));
  window.addEventListener("online", () => netLog.info("back online"));
}
