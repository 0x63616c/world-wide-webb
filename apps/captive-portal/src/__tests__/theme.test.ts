import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The theme is verified at the CSS-source level: jsdom does not compute the
// Tailwind v4 cascade or apply @font-face, so asserting on getComputedStyle
// would be meaningless. These checks pin the 1:1 token port + the self-hosted
// font contract that captive webviews require (no runtime CDN).
const themeCss = readFileSync(resolve(__dirname, "../styles/theme.css"), "utf8");
const indexHtml = readFileSync(resolve(__dirname, "../../index.html"), "utf8");

describe("captive-portal theme tokens (1:1 with design theme.css)", () => {
  it("page background is pure #000", () => {
    expect(themeCss).toMatch(/--background:\s*#000000/);
    // The body paints the background token, not a near-black.
    expect(themeCss).toMatch(/background:\s*var\(--background\)/);
  });

  it("ports the surface + line + text tokens verbatim", () => {
    const tokens: Array<[string, string]> = [
      ["--card", "#0a0a0a"],
      ["--card-elevated", "#111111"],
      ["--popover", "#0c0c0c"],
      ["--border", "#1f1f1f"],
      ["--border-strong", "#2b2b2b"],
      ["--input-border", "#2b2b2b"],
      ["--foreground", "#fafafa"],
      ["--muted-foreground", "#a1a1a1"],
      ["--faint-foreground", "#6b6b6b"],
      ["--primary", "#ffffff"],
      ["--primary-foreground", "#0a0a0a"],
    ];
    for (const [name, value] of tokens) {
      expect(themeCss).toContain(`${name}: ${value}`);
    }
  });

  it("ports the state colors (error + success) verbatim", () => {
    expect(themeCss).toContain("--destructive: #ff5a5f");
    expect(themeCss).toContain("--success: #4cc38a");
  });

  it("ports the shape + radius tokens verbatim", () => {
    expect(themeCss).toContain("--radius-card: 14px");
    expect(themeCss).toContain("--radius-control: 9px");
    expect(themeCss).toContain("--radius-sm: 7px");
  });

  it("sets the Geist / Geist Mono font families on the tokens", () => {
    expect(themeCss).toMatch(/--font-sans:\s*"Geist"/);
    expect(themeCss).toMatch(/--font-mono:\s*"Geist Mono"/);
  });
});

describe("self-hosted fonts (no runtime CDN)", () => {
  it("makes NO external font CDN request (the design @import is dropped)", () => {
    expect(themeCss).not.toContain("fonts.googleapis.com");
    expect(themeCss).not.toContain("fonts.gstatic.com");
    expect(themeCss).not.toMatch(/@import\s+url\(["']?https?:/);
  });

  it("declares @font-face for Geist + Geist Mono from local /fonts paths", () => {
    expect(themeCss).toContain('font-family: "Geist"');
    expect(themeCss).toContain('font-family: "Geist Mono"');
    expect(themeCss).toContain("url(/fonts/geist-latin-wght-normal.woff2)");
    expect(themeCss).toContain("url(/fonts/geist-mono-latin-wght-normal.woff2)");
    // Variable fonts span the weight axis the design uses (Geist 400-700,
    // Mono 400-600); a single variable face covers both.
    expect(themeCss).toMatch(/font-weight:\s*100\s+900/);
    // No swap flash on a kiosk reload.
    expect(themeCss).toContain("font-display: block");
  });

  it("preloads both woff2 in index.html so first paint is in the web font", () => {
    expect(indexHtml).toContain("/fonts/geist-latin-wght-normal.woff2");
    expect(indexHtml).toContain("/fonts/geist-mono-latin-wght-normal.woff2");
    expect(indexHtml).toMatch(/rel="preload"/);
  });
});
