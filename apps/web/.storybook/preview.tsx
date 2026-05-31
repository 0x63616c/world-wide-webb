import type { Decorator, Preview } from "@storybook/react-vite";
import { create } from "storybook/theming/create";

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

// Wraps every story in the board background so tiles render against the correct
// dark surface rather than Storybook's default white canvas.
const BoardDecorator: Decorator = (Story, context) => {
  const useBoardWrapper = context.parameters.boardWrapper !== false;
  if (!useBoardWrapper) return <Story />;

  return (
    <div
      className="e-root"
      style={{
        background: "var(--bg)",
        minHeight: "100vh",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        padding: 20,
        boxSizing: "border-box",
      }}
    >
      <Story />
    </div>
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
