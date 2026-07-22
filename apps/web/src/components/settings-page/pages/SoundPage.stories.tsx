import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { VolumeSection } from "./SoundPage";

// Matches the Settings content column (720px on var(--bg)) so the card reads the
// way it does in the shell.
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

const meta = {
  title: "Pages/Settings/Sound",
  component: VolumeSection,
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
  decorators: [
    (Story) => (
      <ColumnFrame>
        <Story />
      </ColumnFrame>
    ),
  ],
} satisfies Meta<typeof VolumeSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** On the panel: the slider drives the device's real output volume. */
export const OnThePanel: Story = {
  args: { volume: 0.5, available: true, onChange: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const slider = canvas.getByRole("slider", { name: "Volume" });
    await expect(slider).toBeEnabled();
    await expect(canvas.getByText("50%")).toBeInTheDocument();
    await expect(canvas.queryByText("Not available on this device")).not.toBeInTheDocument();
  },
};

/** Muted is just zero , which is why there is no separate mute control. */
export const Muted: Story = {
  args: { volume: 0, available: true, onChange: fn() },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("0%")).toBeInTheDocument();
  },
};

export const FullVolume: Story = {
  args: { volume: 1, available: true, onChange: fn() },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("100%")).toBeInTheDocument();
  },
};

/**
 * In a browser or Storybook there is no way to set system volume, so the
 * control is disabled and says so rather than appearing to work.
 */
export const NotAvailable: Story = {
  args: { volume: 0.5, available: false, onChange: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("slider", { name: "Volume" })).toBeDisabled();
    await expect(canvas.getByText("Not available on this device")).toBeInTheDocument();
  },
};
