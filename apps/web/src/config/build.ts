// The git short SHA of the web bundle currently running. Vite replaces
// `__BUILD_HASH__` at build time via `define` (see vite.config.ts), sourced from
// the BUILD_HASH env (CI passes the commit SHA) or a local `git rev-parse`.
// In test/runtime envs where the define is absent, `typeof` on the undeclared
// global is safe and we fall back to "dev".
declare const __BUILD_HASH__: string;

export const BUILD_HASH: string = typeof __BUILD_HASH__ === "string" ? __BUILD_HASH__ : "dev";
