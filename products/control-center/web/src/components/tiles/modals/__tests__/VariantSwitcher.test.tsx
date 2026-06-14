/**
 * VariantSwitcher , floating variant selector unit tests.
 *
 * The critical invariant (www-5b54): the switcher MUST portal to document.body so
 * it shares the Modal's body-level stacking context. Rendered inside #stage
 * (position:fixed → own stacking context) its zIndex:110 can never beat the
 * body-portaled Modal's zIndex:100, leaving it buried behind the backdrop.
 */

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveVariant } from "../types";
import { VariantSwitcher } from "../VariantSwitcher";

afterEach(cleanup);

function variant(slug: string, label: string): LiveVariant {
  return { slug, label, render: () => null };
}

const VARIANTS = [variant("a", "Alpha"), variant("b", "Beta"), variant("c", "Gamma")];

describe("VariantSwitcher , stacking / portal", () => {
  it("portals the tablist to document.body, not into its render parent", () => {
    // Render inside a stand-in for #stage (its own stacking context). If the
    // switcher rendered in-tree it would be trapped here; portaling lifts it out.
    const { container } = render(
      <div id="stage-standin" style={{ position: "fixed" }}>
        <VariantSwitcher variants={VARIANTS} activeSlug="a" onSelect={vi.fn()} />
      </div>,
    );
    // Present in the document...
    expect(screen.getByRole("tablist", { name: "Modal variant" })).toBeInTheDocument();
    // ...but NOT a descendant of the #stage-standin render parent.
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });
});

describe("VariantSwitcher , interaction", () => {
  it("renders one tab per variant", () => {
    render(<VariantSwitcher variants={VARIANTS} activeSlug="a" onSelect={vi.fn()} />);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("marks the active variant with aria-selected", () => {
    render(<VariantSwitcher variants={VARIANTS} activeSlug="b" onSelect={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "false");
  });

  it("fires onSelect with the variant slug when a tab is clicked", () => {
    const onSelect = vi.fn();
    render(<VariantSwitcher variants={VARIANTS} activeSlug="a" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("tab", { name: "Gamma" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("c");
  });
});
