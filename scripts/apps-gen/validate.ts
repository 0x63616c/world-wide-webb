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
  // extended in Slice 5: duplicate router-key + duplicate table-name checks
  // land with Task 5.4, once facets (and therefore router keys / table names)
  // exist. No-op branches here keep validate()'s signature stable across the
  // slice boundary.
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
