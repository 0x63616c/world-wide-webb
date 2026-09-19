import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import "@testing-library/jest-dom";
import { Skeleton } from "../Skeleton";
import { Tile } from "../Tile";
import { TileHeader } from "../TileHeader";

describe("Tile", () => {
  test("renders children inside .tile className", () => {
    const { container } = render(<Tile>hello</Tile>);
    const div = container.firstChild as HTMLElement;
    expect(div).toHaveClass("tile");
    expect(div).toHaveTextContent("hello");
  });

  test("accepts padding prop and applies it via inline style", () => {
    const { container } = render(<Tile padding={28}>content</Tile>);
    const div = container.firstChild as HTMLElement;
    expect(div).toHaveStyle({ padding: "28px" });
  });
});

describe("TileHeader", () => {
  test("small: renders icon + title at default iconSize=19 / titleSize=17.5", () => {
    const { container } = render(<TileHeader icon="wifi" title="Network" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "19");
    expect(svg).toHaveAttribute("height", "19");
    const title = screen.getByText("Network");
    expect(title).toHaveStyle({ fontSize: "17.5px" });
  });

  test("large: accepts iconSize=22 / titleSize=19 for Tesla-size header", () => {
    const { container } = render(
      <TileHeader icon="car" title="Tesla" iconSize={22} titleSize={19} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "22");
    expect(svg).toHaveAttribute("height", "22");
    const title = screen.getByText("Tesla");
    expect(title).toHaveStyle({ fontSize: "19px" });
  });

  test("renders right slot at margin-left:auto when provided", () => {
    render(<TileHeader icon="wifi" title="WiFi" right={<span data-testid="rt">pill</span>} />);
    const rt = screen.getByTestId("rt").parentElement as HTMLElement;
    expect(rt).toHaveStyle({ marginLeft: "auto" });
  });
});

describe("Skeleton", () => {
  test("renders a div with shimmer animation style", () => {
    const { container } = render(<Skeleton w={120} h={16} />);
    const div = container.firstChild as HTMLElement;
    expect(div).toBeInTheDocument();
    expect(div.style.animation).toContain("shimmer");
  });

  test("accepts w and h props", () => {
    const { container } = render(<Skeleton w={200} h={24} />);
    const div = container.firstChild as HTMLElement;
    expect(div).toHaveStyle({ width: "200px", height: "24px" });
  });
});
