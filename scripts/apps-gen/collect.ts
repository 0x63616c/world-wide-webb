import { TILE_REGISTRY } from "../../apps/web/src/lib/tile-registry";

/** @public shared shape between collect() and validate(); consumed by the codegen emitter (Task 3.3), not yet built. */
export interface CollectedApp {
  id: string;
  tile: { label: string; worldCol: number; worldRow: number; cols: number; rows: number };
  guestExposed: boolean;
  home: boolean;
  sensitive: boolean;
  source: "feature" | "registry";
}
export interface AppModel {
  apps: CollectedApp[];
}

// Slice 3: features/ is empty, so the model is the registry alone. Slice 5 adds
// the features/*/manifest.ts glob and unions it with the registry leftovers.
// TILE_REGISTRY has no `guestExposed`/`sensitive` field today, so every
// registry-sourced app collects guestExposed=false and sensitive=false (the
// guest-wifi canary is deliberately not sensitive, roadmap decision 16); the
// defensive casts below tolerate a future registry shape without changing this
// slice's behavior.
/** @public consumed by the codegen emitter (Task 3.3), not yet built. */
export async function collect(): Promise<AppModel> {
  const apps: CollectedApp[] = TILE_REGISTRY.map((t) => ({
    id: t.id,
    tile: {
      label: t.label,
      worldCol: t.worldCol,
      worldRow: t.worldRow,
      cols: t.cols,
      rows: t.rows,
    },
    guestExposed: false,
    home: Boolean((t as { home?: boolean }).home),
    sensitive: Boolean((t as { sensitive?: boolean }).sensitive),
    source: "registry",
  }));
  return { apps };
}
