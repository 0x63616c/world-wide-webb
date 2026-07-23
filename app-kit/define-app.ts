import type { ComponentType } from "react";

export const APP_BRAND = Symbol.for("app-kit.app");

export interface TileSpec {
  label: string;
  component: ComponentType;
  // Matches the real tile-registry field (an identity-only slot: the full-screen
  // view is looked up by identity, never rendered generically), so it is typed
  // ComponentType<never> — which accepts a prop-taking view like a status tile.
  viewComponent?: ComponentType<never>;
  worldCol: number;
  worldRow: number;
  cols: number;
  rows: number;
}
export interface AppManifest {
  id: string;
  tile: TileSpec;
  guestExposed?: boolean;
  home?: boolean;
  sensitive?: boolean;
}

/** Brand + pass-through. The manifest is authored inline; codegen collects it. */
export function defineApp(m: AppManifest): AppManifest {
  return Object.assign(Object.create(null), m, { [APP_BRAND]: true }) as AppManifest;
}
