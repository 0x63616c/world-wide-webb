import { addons } from "storybook/manager-api";
import { create } from "storybook/theming/create";

// Custom dark theme matching tokens.css , sidebar/toolbar/addons panel all dark.
const eveeTheme = create({
  base: "dark",
  brandTitle: "Control Center",

  // App/UI chrome colors from tokens.css
  appBg: "#060708",
  appContentBg: "#0c0e11",
  appPreviewBg: "#060708",
  appBorderColor: "rgba(255,255,255,0.06)",
  appBorderRadius: 12,

  // Text
  textColor: "#eef0f2",
  textMutedColor: "#9197a1",

  // Toolbar
  barTextColor: "#9197a1",
  barHoverColor: "#eef0f2",
  barSelectedColor: "#5be37d",
  barBg: "#0c0e11",

  // Input / form
  inputBg: "#15191e",
  inputBorder: "rgba(255,255,255,0.06)",
  inputTextColor: "#eef0f2",
  inputBorderRadius: 8,

  // Accent (green from --acc)
  colorPrimary: "#5be37d",
  colorSecondary: "#37c95e",
});

addons.setConfig({ theme: eveeTheme });
