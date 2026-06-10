import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

function getAbsolutePath(value: string) {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"],
  addons: [
    getAbsolutePath("@storybook/addon-docs"),
    getAbsolutePath("@storybook/addon-a11y"),
    getAbsolutePath("@storybook/addon-vitest"),
    getAbsolutePath("@chromatic-com/storybook"),
    getAbsolutePath("@storybook/addon-mcp"),
  ],
  framework: getAbsolutePath("@storybook/react-vite"),
  // Compose the captive-portal Storybook in as its own collapsed sidebar
  // section (refs, NOT a glob-merge — its vite/tailwind config stays
  // self-contained; CC-q002.5). In dev it points at the portal's own dev
  // server (`bun run --filter @cc/captive-portal storybook`, port 6007); in a
  // static build it's served as a sibling path of the host bundle. The host
  // Storybook Docker image (Dockerfile.storybook, infra-owned CC-q002.2) builds
  // the portal Storybook into storybook-static/captive-portal so this relative
  // ref resolves in production.
  refs: (_cfg, { configType }) => ({
    "captive-portal": {
      title: "Captive Portal",
      url: configType === "DEVELOPMENT" ? "http://localhost:6007" : "/captive-portal",
    },
  }),
};

export default config;
