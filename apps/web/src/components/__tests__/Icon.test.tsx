/**
 * Icon — verifies the glyphs are backed by lucide-react (www-cojw).
 *
 * The wrapper API (IconName union + s/c/sw props) is unchanged; only the GLYPHS
 * are now lucide components. lucide stamps each svg with a `lucide-<name>` class,
 * which is the observable we assert to prove the real library renders (not the
 * old hand-drawn paths).
 */

import "@testing-library/jest-dom";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Icon, type IconName } from "../Icon";

afterEach(cleanup);

describe("Icon — lucide-backed glyphs", () => {
  // name → the lucide class lucide-react stamps on its <svg>.
  const cases: [IconName, string][] = [
    ["lamp", "lucide-lamp"],
    ["bulb", "lucide-lightbulb"],
    ["bulb-off", "lucide-lightbulb-off"],
    ["fan", "lucide-fan"],
    ["sparkles", "lucide-sparkles"],
    ["globe", "lucide-globe"],
  ];

  for (const [name, cls] of cases) {
    it(`renders the lucide glyph for "${name}"`, () => {
      const { container } = render(<Icon name={name} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("class") ?? "").toContain(cls);
    });
  }

  it("forwards size, color and stroke width to the glyph", () => {
    const { container } = render(<Icon name="bulb" s={26} c="rgb(1, 2, 3)" sw={2} />);
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("width")).toBe("26");
    expect(svg.getAttribute("height")).toBe("26");
    expect(svg.getAttribute("stroke")).toBe("rgb(1, 2, 3)");
    expect(svg.getAttribute("stroke-width")).toBe("2");
  });
});
