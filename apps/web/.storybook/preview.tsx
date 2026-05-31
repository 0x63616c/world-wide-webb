import type { Decorator, Preview } from "@storybook/react-vite";
import { createElement } from "react";
import { create } from "storybook/theming/create";
import {
  BOARD_H,
  BOARD_PADDING,
  BOARD_W,
  GRID_COLS,
  GRID_GAP,
  GRID_ROWS,
} from "../src/lib/grid-constants";
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

// Wraps every tile story in the real board grid at its declared gridArea so
// tiles render at true production footprint — no separate size to maintain.
// Falls back to a plain dark wrapper for non-tile stories.
const BoardDecorator: Decorator = (Story, context) => {
  if (context.parameters.boardWrapper === false) return createElement(Story);

  const entry = registryEntryForComponent(context.component);

  if (entry) {
    return createElement(
      "div",
      {
        style: {
          width: BOARD_W,
          height: BOARD_H,
          display: "grid",
          gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
          gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`,
          gap: GRID_GAP,
          padding: BOARD_PADDING,
          boxSizing: "border-box",
          background: "var(--bg)",
        },
        className: "e-root",
      },
      createElement(
        "div",
        { style: { gridArea: entry.gridArea, display: "flex", flexDirection: "column" } },
        createElement(Story),
      ),
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
