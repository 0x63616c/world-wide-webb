import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import "@testing-library/jest-dom";
import { Chip } from "../Chip";
import { Pill } from "../Pill";
import { Skeleton } from "../Skeleton";
import { Stat } from "../Stat";
import { StatusDot } from "../StatusDot";
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

describe("Stat", () => {
  test("renders label, value, and optional sub line", () => {
    render(<Stat label="Speed" value="72 mph" sub="avg last 7d" />);
    expect(screen.getByText("Speed")).toBeInTheDocument();
    expect(screen.getByText("72 mph")).toBeInTheDocument();
    expect(screen.getByText("avg last 7d")).toBeInTheDocument();
  });

  test("applies var(--acc) color when accent=true", () => {
    const { container } = render(<Stat label="SOC" value="82%" accent />);
    const value = container.querySelector("[data-stat-value]") as HTMLElement;
    expect(value).toHaveStyle({ color: "var(--acc)" });
  });
});

describe("Pill", () => {
  test("tone=default renders className='pill'", () => {
    const { container } = render(<Pill>default</Pill>);
    expect(container.firstChild).toHaveClass("pill");
    expect(container.firstChild).not.toHaveClass("on");
    expect(container.firstChild).not.toHaveClass("amber");
  });

  test("tone=on renders className='pill on'", () => {
    const { container } = render(<Pill tone="on">on</Pill>);
    expect(container.firstChild).toHaveClass("pill");
    expect(container.firstChild).toHaveClass("on");
  });

  test("tone=amber renders className='pill amber'", () => {
    const { container } = render(<Pill tone="amber">warn</Pill>);
    expect(container.firstChild).toHaveClass("pill");
    expect(container.firstChild).toHaveClass("amber");
  });
});

describe("Chip", () => {
  test("active=true renders className='chip on'", () => {
    const { container } = render(
      <Chip active={true} onClick={() => {}}>
        Cool
      </Chip>,
    );
    expect(container.firstChild).toHaveClass("chip");
    expect(container.firstChild).toHaveClass("on");
  });

  test("active=false renders className='chip'", () => {
    const { container } = render(
      <Chip active={false} onClick={() => {}}>
        Cool
      </Chip>,
    );
    expect(container.firstChild).toHaveClass("chip");
    expect(container.firstChild).not.toHaveClass("on");
  });
});

describe("StatusDot", () => {
  test("online=true renders span with className dot (pulse animation)", () => {
    const { container } = render(<StatusDot online={true} />);
    expect(container.querySelector(".dot")).toBeInTheDocument();
  });

  test("online=false renders a muted dot (no pulse)", () => {
    const { container } = render(<StatusDot online={false} />);
    expect(container.querySelector(".dot")).not.toBeInTheDocument();
    const span = container.firstChild as HTMLElement;
    expect(span).toBeInTheDocument();
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
