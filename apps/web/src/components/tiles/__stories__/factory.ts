import type { Decorator, Meta } from "@storybook/react-vite";
import type { ComponentType } from "react";
import { createElement } from "react";
import {
  BOARD_H,
  BOARD_PADDING,
  BOARD_W,
  GRID_COLS,
  GRID_GAP,
  GRID_ROWS,
} from "../../../lib/grid-constants";
import type { TileRegistryEntry } from "../../../lib/tile-registry";

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

/**
 * Returns a Storybook decorator that places a story inside the real board grid
 * at the given gridArea. The container is exactly BOARD_W×BOARD_H so the
 * CSS grid engine sizes the tile identically to production — no separate pixel
 * number to maintain, impossible to drift.
 *
 * Set parameters.boardWrapper=false on stories using this decorator to opt out
 * of the global BoardDecorator (which adds its own padding).
 */
export function makeGridDecorator(gridArea: string): Decorator {
  return (Story) =>
    createElement(
      "div",
      {
        style: {
          width: BOARD_W,
          height: BOARD_H,
          display: "grid",
          gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
          gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`,
          gap: GRID_GAP,
          padding: BOARD_PADDING,
          boxSizing: "border-box",
          background: "var(--bg)",
        },
      },
      createElement(
        "div",
        {
          style: { gridArea, display: "flex", flexDirection: "column" },
          "data-testid": "tile-grid-cell",
        },
        createElement(Story),
      ),
    );
}

/**
 * Creates a Storybook story object for a registry entry that renders the tile
 * at its true grid footprint. Suitable for use in registry.stories.tsx.
 */
export function makeRegistryStory(entry: TileRegistryEntry) {
  return {
    name: `${entry.id} (${entry.cols}×${entry.rows})`,
    decorators: [makeGridDecorator(entry.gridArea)],
    parameters: {
      boardWrapper: false,
      layout: "fullscreen",
    },
    render: () => createElement(entry.component),
    play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const cell = canvasElement.querySelector("[data-testid='tile-grid-cell']");
      if (!cell) throw new Error(`Grid cell not found for ${entry.id}`);
    },
  };
}
