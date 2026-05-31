/**
 * Shared story factory for tile components.
 *
 * Every tile story needs the same meta boilerplate: Storybook path under
 * "Tiles/", autodocs tag, and the component reference. This factory
 * centralises those fields so per-tile story files only declare states.
 *
 * Usage:
 *   import { defineTileMeta } from "./__stories__/factory";
 *   const meta = { ...defineTileMeta("MyTileView", MyTileView), ...perTileOverrides };
 */

import type { Meta } from "@storybook/react-vite";
// ComponentType<any> is intentional: tile components have required props that
// TypeScript cannot verify at this factory level; callers use satisfies Meta<...>
// on the assembled meta to catch any mismatches.
import type { ComponentType } from "react";

// biome-ignore lint/suspicious/noExplicitAny: factory accepts any component shape
type TileMeta<C extends ComponentType<any>> = Pick<Meta<C>, "title" | "component" | "tags">;

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
