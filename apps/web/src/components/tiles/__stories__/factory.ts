/**
 * Shared story factory for tile components.
 *
 * Every tile story needs the same meta boilerplate: Storybook path under
 * "Tiles/", autodocs tag, and the component reference. This factory
 * centralises those fields so per-tile story files only declare states.
 *
 * Usage:
 *   import { defineTileMeta, TILE_STATUS_ARG_TYPE, BOOL_ARG_TYPE } from "./__stories__/factory";
 *   const meta = { ...defineTileMeta("MyTileView", MyTileView), ...perTileOverrides };
 */

import type { Meta } from "@storybook/react-vite";
// ComponentType<any> is intentional: tile components have required props that
// TypeScript cannot verify at this factory level; callers use satisfies Meta<...>
// on the assembled meta to catch any mismatches.
import type { ComponentType } from "react";

// biome-ignore lint/suspicious/noExplicitAny: factory accepts any component shape
type TileMeta<C extends ComponentType<any>> = Pick<Meta<C>, "title" | "component" | "tags">;

// Storybook's ArgType is internal; use a plain record shape that satisfies Meta argTypes.
// biome-ignore lint/suspicious/noExplicitAny: mirrors Storybook's own argTypes value type
type TileArgType = Record<string, any>;

/**
 * Shared argType for the standard loading/populated/error discriminator.
 * Tiles that expose a `status` prop should spread this into their argTypes
 * rather than re-declaring it inline.
 */
export const TILE_STATUS_ARG_TYPE: TileArgType = {
  control: "radio",
  options: ["loading", "populated", "error"],
  description: "Data load state — loading/error renders a shimmer skeleton",
};

/**
 * Factory for a labelled boolean toggle argType (online, live, etc.).
 * Pass a human-readable description so each tile's intent is clear in Storybook.
 */
export function boolArgType(description: string): TileArgType {
  return { control: "boolean", description };
}

/**
 * Returns the standard Meta fields shared by every tile story.
 * Pass extra tags (e.g. "a11y") in additionalTags to merge with "autodocs".
 */
// biome-ignore lint/suspicious/noExplicitAny: factory accepts any component shape
export function defineTileMeta<C extends ComponentType<any>>(
  name: string,
  component: C,
  additionalTags: string[] = [],
): TileMeta<C> {
  return {
    title: `Tiles/${name}`,
    component,
    tags: ["autodocs", ...additionalTags],
  };
}
