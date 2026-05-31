import type { Meta } from "@storybook/react-vite";
import type { ComponentType } from "react";

// biome-ignore lint/suspicious/noExplicitAny: factory accepts any component shape
type TileMeta<C extends ComponentType<any>> = Pick<Meta<C>, "title" | "component" | "tags">;

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
 * Grid sizing is applied automatically by the global BoardDecorator in
 * preview.tsx via registryEntryForComponent — no per-story config needed.
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
