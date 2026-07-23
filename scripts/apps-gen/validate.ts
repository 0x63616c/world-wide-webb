/**
 * The codegen consistency check (Track C Q7). Every app collected from
 * features/*/ /*manifest.ts + the tile registry is validated as one model
 * before anything is emitted: duplicate ids, home-tile count, tile-rect
 * overlap, and the guestExposed flag agreeing with the reviewed
 * GUEST_EXPOSED allowlist (widening the guest surface is a deliberate,
 * security-reviewed edit to that allowlist, never an implicit flag flip).
 */
export class CodegenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodegenError";
  }
}

interface Rect {
  worldCol: number;
  worldRow: number;
  cols: number;
  rows: number;
}
interface ValApp {
  id: string;
  home?: boolean;
  guestExposed?: boolean;
  tile: Rect;
}
interface Model {
  apps: ValApp[];
  /** Collected pgTable names (feature + base schema); a duplicate name is a fold error. */
  tables?: { name: string; source: string }[];
  /** Collected top-level tRPC router keys across features; a duplicate key is a fold error. */
  routerKeys?: { key: string; source: string }[];
  /** Collected `defineJobs` facet entries; a duplicate job type would let two
   *  features both claim the same queue rows. */
  jobs?: { type: string; source: string }[];
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.worldCol < b.worldCol + b.cols &&
    a.worldCol + a.cols > b.worldCol &&
    a.worldRow < b.worldRow + b.rows &&
    a.worldRow + a.rows > b.worldRow
  );
}

/** @public consumed by the codegen emitter (Task 3.3), not yet built. */
export function validate(model: Model, guestExposed: readonly string[]): void {
  const allow = new Set(guestExposed);
  const seen = new Set<string>();

  // Duplicate table name across the union of feature schemas + the base
  // apps/api schema. Two tables with the same SQL name would make the generated
  // schema barrel ambiguous (and silently drop one from drizzle's migration
  // diff), so this is a hard fold error.
  if (model.tables) {
    const seenTable = new Map<string, string>();
    for (const t of model.tables) {
      const prev = seenTable.get(t.name);
      if (prev) {
        throw new CodegenError(
          `duplicate table name '${t.name}' (declared by ${prev} and ${t.source}) — a folded feature must not re-declare a table`,
        );
      }
      seenTable.set(t.name, t.source);
    }
  }

  // Duplicate top-level router key across features. Two features exposing the
  // same namespace (e.g. both `portal`) would collide when merged into the app
  // router, so reject it before emit.
  if (model.routerKeys) {
    const seenKey = new Map<string, string>();
    for (const r of model.routerKeys) {
      const prev = seenKey.get(r.key);
      if (prev) {
        throw new CodegenError(
          `duplicate router key '${r.key}' (exposed by ${prev} and ${r.source}) — two features cannot mount the same tRPC namespace`,
        );
      }
      seenKey.set(r.key, r.source);
    }
  }

  // Duplicate job type across features. Two features registering the same
  // `type` would both be claimed against by the worker's single generic drain,
  // so this is a hard fold error (mirrors the dup table / router-key checks).
  if (model.jobs) {
    const seenJob = new Map<string, string>();
    for (const j of model.jobs) {
      const prev = seenJob.get(j.type);
      if (prev) {
        throw new CodegenError(
          `duplicate job type '${j.type}' (declared by ${prev} and ${j.source}) — two features cannot register the same worker job type`,
        );
      }
      seenJob.set(j.type, j.source);
    }
  }

  let homes = 0;
  for (const a of model.apps) {
    if (seen.has(a.id)) throw new CodegenError(`duplicate app id: ${a.id}`);
    seen.add(a.id);
    if (a.home) homes++;
    const inAllow = allow.has(a.id);
    if (Boolean(a.guestExposed) !== inAllow) {
      throw new CodegenError(
        `app ${a.id}: guestExposed=${Boolean(a.guestExposed)} but GUEST_EXPOSED allowlist ${
          inAllow ? "contains" : "omits"
        } it — widening the guest surface needs an explicit, security-reviewed edit to the allowlist`,
      );
    }
  }
  if (homes !== 1) throw new CodegenError(`expected exactly one home tile, found ${homes}`);
  for (let i = 0; i < model.apps.length; i++)
    for (let j = i + 1; j < model.apps.length; j++)
      if (overlaps(model.apps[i].tile, model.apps[j].tile))
        throw new CodegenError(`tiles ${model.apps[i].id} and ${model.apps[j].id} overlap`);
}
