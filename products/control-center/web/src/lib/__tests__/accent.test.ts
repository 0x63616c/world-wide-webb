import { ACCENTS } from "@cc/api/settings";
import { describe, expect, it } from "vitest";
import { ACCENT_PALETTES, accentPalette, applyAccent } from "../accent";

describe("accent palettes", () => {
  it("covers every accent in the wire contract", () => {
    expect(Object.keys(ACCENT_PALETTES).sort()).toEqual([...ACCENTS].sort());
  });

  it("states rgb as the space-separated channels of acc", () => {
    for (const accent of ACCENTS) {
      const { acc, rgb } = ACCENT_PALETTES[accent];
      const channels = [1, 3, 5].map((i) => Number.parseInt(acc.slice(i, i + 2), 16));
      expect(rgb).toBe(channels.join(" "));
    }
  });

  it("falls back to blue for a value the store somehow let through", () => {
    expect(accentPalette("chartreuse" as never)).toBe(ACCENT_PALETTES.blue);
  });
});

describe("applyAccent", () => {
  it("writes only the three primitives , the tints derive in CSS", () => {
    const root = document.createElement("div");
    applyAccent(root, "orange");
    expect(root.style.getPropertyValue("--acc")).toBe("#ff7a1a");
    expect(root.style.getPropertyValue("--acc-2")).toBe("#e0620a");
    expect(root.style.getPropertyValue("--acc-rgb")).toBe("255 122 26");
    expect(root.style.getPropertyValue("--acc-dim")).toBe("");
  });

  it("stamps the accent key for CSS hooks and screenshots", () => {
    const root = document.createElement("div");
    applyAccent(root, "green");
    expect(root.dataset.accent).toBe("green");
  });
});
