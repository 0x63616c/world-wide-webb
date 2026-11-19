// Swappable colour module. Everything that draws reads colours from PALETTE, so a new
// palette is one object. "Vercel Neon" is the chosen palette.
import type { BallTypeId } from "./config";

export interface Palette {
  name: string;
  background: string;
  panels: [string, string, string];
  border: string;
  textSecondary: string;
  textPrimary: string;
  highlight: string;
  wall: string;
  golden: string;
  tiers: [string, string, string, string, string];
  balls: Record<BallTypeId, string>;
  accents: [string, string];
}

export const VERCEL_NEON: Palette = {
  name: "Vercel Neon",
  background: "#000000",
  panels: ["#0a0a0a", "#111111", "#1a1a1a"],
  border: "#333333",
  textSecondary: "#a1a1a1",
  textPrimary: "#ededed",
  highlight: "#ffffff",
  wall: "#ededed",
  golden: "#ffd500",
  tiers: ["#00e676", "#d4ff3a", "#ffb224", "#ff1f5a", "#b4005a"],
  balls: {
    basic: "#ffffff",
    fast: "#00d8ff",
    heavy: "#ff6a00",
    lightning: "#50fff0",
    bomb: "#ff2bd6",
    sniper: "#8b5cff",
    ghost: "#0070f3",
  },
  accents: ["#0070f3", "#50fff0"],
};

export const PALETTE: Palette = VERCEL_NEON;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
