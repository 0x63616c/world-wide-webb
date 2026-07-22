// Asserts index.html branding strings so regressions are caught immediately.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");

describe("index.html branding", () => {
  it("sets <title> to 'Control Center'", () => {
    expect(html).toContain("<title>Control Center</title>");
  });

  it("sets apple-mobile-web-app-title to 'Control Center'", () => {
    expect(html).toContain('content="Control Center"');
  });

  it("does not contain old branding 'world-wide-webb'", () => {
    expect(html).not.toContain("world-wide-webb");
  });
});
