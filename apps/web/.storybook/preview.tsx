import type { Decorator, Preview } from "@storybook/react-vite";
import { createElement } from "react";
import { create } from "storybook/theming/create";
import { tilePixelSize } from "../src/lib/grid-constants";
import { registryEntryForComponent } from "../src/lib/tile-registry";

// Board CSS — tokens + shimmer keyframes + tile class definitions
import "../src/styles/globals.css";

// Shared dark theme for docs pages (MDX/autodocs) — keeps docs background dark.
const eveeTheme = create({
  base: "dark",
  appBg: "#060708",
  appContentBg: "#0c0e11",
  appPreviewBg: "#060708",
  appBorderColor: "rgba(255,255,255,0.06)",
  textColor: "#eef0f2",
  textMutedColor: "#9197a1",
  barSelectedColor: "#5be37d",
  colorPrimary: "#5be37d",
  colorSecondary: "#37c95e",
});

// Sizes every tile story to its exact production footprint by wrapping it in a
// fixed width×height box derived from the registry (cols/rows → pixels). Shows
// just the tile at true size — not the whole board. Non-tile stories get a
// plain dark wrapper.
const BoardDecorator: Decorator = (Story, context) => {
  if (context.parameters.boardWrapper === false) return createElement(Story);

  const entry = registryEntryForComponent(context.component);

  if (entry) {
    const { width, height } = tilePixelSize(entry.cols, entry.rows);
    return createElement(
      "div",
      {
        className: "e-root",
        style: {
          width,
          height,
          display: "flex",
          flexDirection: "column",
          background: "var(--bg)",
        },
      },
      createElement(Story),
    );
  }

  return createElement(
    "div",
    {
      className: "e-root",
      style: {
        background: "var(--bg)",
        minHeight: "100vh",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        padding: 20,
        boxSizing: "border-box",
      },
    },
    createElement(Story),
  );
};

const preview: Preview = {
  decorators: [BoardDecorator],
  parameters: {
    // Dark theme for MDX/autodocs pages so docs are never white.
    docs: { theme: eveeTheme },
    // Dark canvas background matching --bg token (#060708)
    backgrounds: {
      default: "board",
      values: [{ name: "board", value: "#060708" }],
    },
    // Fixed 1366×1024 — the physical wall-panel dimensions
    viewport: {
      defaultViewport: "board",
      viewports: {
        board: {
          name: "Wall Panel 1366×1024",
          styles: { width: "1366px", height: "1024px" },
          type: "desktop",
        },
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // Flag violations in the test UI without failing CI
      test: "todo",
    },
  },
};

export default preview;
