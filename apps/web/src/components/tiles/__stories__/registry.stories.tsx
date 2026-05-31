/**
 * One story per tile registry entry, each rendered inside the real board grid
 * at its declared gridArea. Sizing is driven by the same CSS grid engine as
 * production — tiles cannot be squished here without also being squished on the
 * wall panel.
 *
 * Export keys match tile IDs (tile_clock, tile_weath, …) so the CI guard test
 * in registry-guards.test.ts can verify coverage by key lookup.
 *
 * To add a new tile: add it to TILE_REGISTRY in tile-registry.ts, then add one
 * export below. CI will fail if a registry entry has no corresponding story.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TILE_REGISTRY } from "../../../lib/tile-registry";
import { makeRegistryStory } from "./factory";

const meta: Meta = {
  title: "Board/Registry",
  tags: ["autodocs"],
};

export default meta;

function entry(id: string) {
  const e = TILE_REGISTRY.find((t) => t.id === id);
  if (!e) throw new Error(`tile-registry: no entry for ${id}`);
  return e;
}

// Export keys must match tile IDs — the CI guard tests this.
export const tile_clock: StoryObj = makeRegistryStory(entry("tile_clock"));
export const tile_weath: StoryObj = makeRegistryStory(entry("tile_weath"));
export const tile_wifi: StoryObj = makeRegistryStory(entry("tile_wifi"));
export const tile_tesla: StoryObj = makeRegistryStory(entry("tile_tesla"));
export const tile_hourly: StoryObj = makeRegistryStory(entry("tile_hourly"));
export const tile_ctrl: StoryObj = makeRegistryStory(entry("tile_ctrl"));
export const tile_dogcam: StoryObj = makeRegistryStory(entry("tile_dogcam"));
export const tile_ac: StoryObj = makeRegistryStory(entry("tile_ac"));
export const tile_event: StoryObj = makeRegistryStory(entry("tile_event"));
