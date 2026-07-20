import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import type { PageProps } from "../SettingsPage";
import { BoardPage } from "./BoardPage";
import { DevicePage } from "./DevicePage";
import { DisplayPage } from "./DisplayPage";

// The real pages live inside the full-page Settings content column (720px, on
// var(--bg)); this frame reproduces that footprint so each page reads the way it
// does in the shell. Pages read/write the shared settings store, so every
// control here is live.
function ColumnFrame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 40, background: "var(--bg)", minHeight: "100vh" }}>
      <div
        style={{
          width: 720,
          margin: "0 auto",
          color: "var(--ink)",
          fontFamily: "var(--ui)",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {children}
      </div>
    </div>
  );
}

const pageProps: PageProps = { onClose: fn(), onOpenLevel: fn(), onOpenClean: fn() };

const meta = {
  title: "Pages/Settings/Pages",
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
  decorators: [
    (Story) => (
      <ColumnFrame>
        <Story />
      </ColumnFrame>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Device: Story = {
  render: () => <DevicePage {...pageProps} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("textbox", { name: "Device name" })).toBeInTheDocument();
    await expect(canvas.getByText("Battery")).toBeInTheDocument();
    await expect(canvas.getByText("Level")).toBeInTheDocument();
    await expect(canvas.getByText("Device ID")).toBeInTheDocument();
  },
};

export const Display: Story = {
  render: () => <DisplayPage {...pageProps} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("slider", { name: "Brightness" })).toBeInTheDocument();
    await expect(canvas.getByRole("switch", { name: "Dim when idle" })).toBeInTheDocument();
    // Idle dimming defaults on, so both sub-sliders render.
    await expect(canvas.getByRole("slider", { name: "Dim after" })).toBeInTheDocument();
    await expect(canvas.getByRole("slider", { name: "Dim level" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Start" })).toBeInTheDocument();
  },
};

export const Board: Story = {
  render: () => <BoardPage {...pageProps} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("switch", { name: "Recenter when idle" })).toBeInTheDocument();
    // Recenter defaults on, so its interval slider renders.
    await expect(canvas.getByRole("slider", { name: "Recenter after" })).toBeInTheDocument();
    await expect(canvas.getByRole("switch", { name: "Minimap" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Edit layout" })).toBeInTheDocument();
  },
};
