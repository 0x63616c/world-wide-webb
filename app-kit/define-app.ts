import type { ComponentType } from "react";

export const APP_BRAND = Symbol.for("app-kit.app");

export interface TileSpec {
  label: string;
  component: ComponentType;
  viewComponent?: ComponentType; // matches the real tile-registry field name
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
