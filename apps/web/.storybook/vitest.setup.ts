// Required by @storybook/addon-vitest: sets up the Storybook channel mock and
// registers afterEach hooks so play-function failures link back to the
// Storybook panel URL. Project annotations are injected by the storybookTest
// Vite plugin at build time; this file only handles runtime setup.
import "@storybook/addon-vitest/internal/setup-file";
