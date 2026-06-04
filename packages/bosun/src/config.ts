// Pure config evaluator: accepts a factory function (or a path to deploy.config.ts)
// and evaluates it to a static Spec with no I/O, no secret values.
//
// "Pure" means: the factory must not call fetch/fs/op or produce any side effects.
// The evaluator enforces this by running the factory and propagating any thrown error —
// if the factory touches the network and the network is unavailable, the error surfaces here.

import type { Spec } from "./spec.ts";

/** A factory function that builds a Spec synchronously or asynchronously. */
export type SpecFactory = (() => Spec) | (() => Promise<Spec>);

/**
 * Evaluate a config factory to its static Spec.
 *
 * The factory must be deterministic and perform no I/O.
 * Any error thrown by the factory (including network errors, if the factory
 * illegally calls fetch/fs) propagates so callers can detect impurity.
 */
export async function evaluateConfig(factory: SpecFactory): Promise<Spec> {
  // Await handles both sync factories (returns Spec) and async ones (returns Promise<Spec>).
  // If the factory throws or rejects, the error propagates — the caller sees it.
  const spec = await factory();
  return spec;
}

/**
 * Load a deploy.config.ts file by path and evaluate it.
 * The file must default-export a Spec or a factory returning a Spec.
 *
 * This is a thin dynamic import wrapper — the heavy lifting is in the caller's
 * deploy.config.ts, which must itself be pure (no I/O).
 */
export async function loadConfig(configPath: string): Promise<Spec> {
  // Dynamic import evaluates the module in the current Bun/Node runtime.
  // If the config calls fetch or reads files, those errors propagate here.
  const mod = await import(configPath);

  // Support both `export default spec` (static) and `export default () => spec` (factory).
  const defaultExport: unknown = mod.default;

  if (typeof defaultExport === "function") {
    return evaluateConfig(defaultExport as SpecFactory);
  }

  // Treat a plain object as an already-evaluated Spec.
  if (defaultExport !== null && typeof defaultExport === "object") {
    return defaultExport as Spec;
  }

  throw new Error(
    `deploy.config.ts must default-export a Spec object or a factory function, got: ${typeof defaultExport}`,
  );
}
