import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { SettingsPanel } from "./SettingsPanel";

// Frames the panel the way the real Modal does (fixed-width --tile panel with a
// header), so the story reads as the actual settings dialog without the portal +
// backdrop. The panel itself reads/writes the shared settings store, so every
// control here is live.
function ModalFrame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: 24, background: "var(--bg)", minHeight: "100vh" }}>
      <div
        style={{
          width: 460,
          background: "var(--tile)",
          color: "var(--ink)",
          border: "1px solid var(--hair)",
          borderRadius: "var(--r)",
          fontFamily: "var(--ui)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Settings</h2>
        </div>
        <div style={{ padding: 20, paddingTop: 0 }}>{children}</div>
      </div>
    </div>
  );
}

const meta = {
  title: "Board/SettingsPanel",
  component: SettingsPanel,
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
  decorators: [
    (Story) => (
      <ModalFrame>
        <Story />
      </ModalFrame>
    ),
  ],
} satisfies Meta<typeof SettingsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The Device section's name field is present (top of the panel).
    await expect(canvas.getByRole("textbox", { name: "Device name" })).toBeInTheDocument();
    // Both idle-dim sliders + the two feature switches are present.
    await expect(canvas.getByRole("slider", { name: "Dim after" })).toBeInTheDocument();
    await expect(canvas.getByRole("slider", { name: "Dim level" })).toBeInTheDocument();
    await expect(canvas.getByRole("switch", { name: "Dim when idle" })).toBeInTheDocument();
    await expect(canvas.getByRole("switch", { name: "FPS meter" })).toBeInTheDocument();
  },
};
