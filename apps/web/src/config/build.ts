// The git short SHA of the web bundle currently running. Vite replaces
// `__BUILD_HASH__` at build time via `define` (see vite.config.ts), sourced from
// the BUILD_HASH env (CI passes the commit SHA) or a local `git rev-parse`.
// In test/runtime envs where the define is absent, `typeof` on the undeclared
// global is safe and we fall back to "dev".
declare const __BUILD_HASH__: string;

export const BUILD_HASH: string = typeof __BUILD_HASH__ === "string" ? __BUILD_HASH__ : "dev";

// Unix-ms build timestamp (commit time), replaced by Vite `define`. Absent in
// test/runtime envs without the define, or when vite.config.ts emits "NaN"
// (Docker build with no .git and no BUILD_TIME env), Number() parses to NaN.
// Callers treat a non-finite value as "no build age available" and render just
// the SHA. Never use "" as the sentinel , Number("") === 0 (finite).
declare const __BUILD_TIME__: string;

export const BUILD_TIME: number =
  typeof __BUILD_TIME__ === "string" ? Number(__BUILD_TIME__) : Number.NaN;
