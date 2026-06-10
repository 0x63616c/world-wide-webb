import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AlertIcon,
  ArrowLeft,
  ArrowRight,
  CheckIcon,
  GlobeMark,
  LockIcon,
  Logo,
  MailIcon,
  UserIcon,
  WifiIcon,
} from "./icons";

const icons = {
  GlobeMark,
  MailIcon,
  UserIcon,
  AlertIcon,
  CheckIcon,
  ArrowLeft,
  ArrowRight,
  WifiIcon,
  LockIcon,
};

describe("icon set", () => {
  it.each(Object.entries(icons))("%s renders a decorative (aria-hidden) svg", (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // currentColor stroke so the icon inherits the .wwb-* container color.
    expect(svg).toHaveAttribute("stroke", "currentColor");
  });

  it("passes through a className", () => {
    const { container } = render(<CheckIcon className="x-test" />);
    expect(container.querySelector("svg")).toHaveClass("x-test");
  });
});

describe("Logo", () => {
  it("wraps the GlobeMark in the .wwb-mark square at the given size", () => {
    const { container } = render(<Logo size={48} />);
    const mark = container.querySelector(".wwb-mark");
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveStyle({ width: "48px", height: "48px" });
    expect(mark?.querySelector("svg")).toBeInTheDocument();
  });

  it("defaults to 44px (the design mark size)", () => {
    const { container } = render(<Logo />);
    expect(container.querySelector(".wwb-mark")).toHaveStyle({ width: "44px" });
  });
});
