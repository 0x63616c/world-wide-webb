import type { Decorator, Preview } from "@storybook/react-vite";
import { createElement } from "react";
import { create } from "storybook/theming/create";
import { INITIAL_VIEWPORTS } from "storybook/viewport";

// The full portal design layer — tokens, self-hosted Geist, every .wwb-*
// primitive class. Importing it here makes every story render on the real
// pure-#000 theme.
import "../src/styles/theme.css";

// Dark docs theme so MDX/autodocs pages match the pure-black portal.
const portalTheme = create({
  base: "dark",
  appBg: "#000000",
  appContentBg: "#0a0a0a",
  appPreviewBg: "#000000",
  appBorderColor: "rgba(255,255,255,0.08)",
  textColor: "#fafafa",
  textMutedColor: "#a1a1a1",
  barSelectedColor: "#fafafa",
  colorPrimary: "#ffffff",
  colorSecondary: "#a1a1a1",
});

// Center each story on the pure-black stage so primitives sit on the real
// background (not a white canvas). On Docs pages, hug the content instead of
// forcing 100vh per story block.
const StageDecorator: Decorator = (Story, context) => {
  const isDocs = context.viewMode === "docs";
  return createElement(
    "div",
    {
      style: {
        background: "var(--background)",
        color: "var(--foreground)",
        fontFamily: "var(--font-sans)",
        ...(isDocs ? {} : { minHeight: "100vh" }),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
      },
    },
    createElement(Story),
  );
};

const preview: Preview = {
  decorators: [StageDecorator],
  parameters: {
    docs: { theme: portalTheme },
    backgrounds: {
      default: "portal",
      values: [{ name: "portal", value: "#000000" }],
    },
    // Phone + desktop presets the design specs (390x844 mobile, 1280x800 desktop).
    viewport: {
      options: {
        mobile: {
          name: "Mobile · 390×844",
          styles: { width: "390px", height: "844px" },
          type: "mobile",
        },
        desktop: {
          name: "Desktop · 1280×800",
          styles: { width: "1280px", height: "800px" },
          type: "desktop",
        },
        ...INITIAL_VIEWPORTS,
      },
    },
    a11y: { test: "todo" },
  },
};

export default preview;
