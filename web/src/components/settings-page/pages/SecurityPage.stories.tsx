import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { setPinCode } from "../../../lib/settings";
import { SecurityPage } from "./SecurityPage";

// The page lives inside the full-page Settings content column (720px, on
// var(--bg)); this frame reproduces that footprint. The change-PIN flow reads
// and writes the shared settings store, so it is fully live here , the decorator
// resets the PIN back to the default before each run so the walkthrough (and any
// rerun) always starts from a known "000000".
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
  title: "Pages/Settings/Security",
  component: SecurityPage,
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
  decorators: [
    (Story) => {
      setPinCode("000000");
      return (
        <ColumnFrame>
          <Story />
        </ColumnFrame>
      );
    },
  ],
} satisfies Meta<typeof SecurityPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function tap(canvas: ReturnType<typeof within>, digits: string) {
  for (const d of digits) {
    await userEvent.click(canvas.getByRole("button", { name: d }));
  }
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Stage 1: current PIN (default 000000) unlocks the change.
    await expect(canvas.getByText("Enter current PIN")).toBeInTheDocument();
    await tap(canvas, "000000");
    // Stage 2: new PIN.
    await expect(canvas.getByText("Enter new PIN")).toBeInTheDocument();
    await tap(canvas, "123456");
    // Stage 3: confirm the new PIN.
    await expect(canvas.getByText("Confirm new PIN")).toBeInTheDocument();
    await tap(canvas, "123456");
    // Done.
    await expect(canvas.getByText("PIN changed")).toBeInTheDocument();
    await expect(canvas.getByText("Synced to all panels.")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Change again" })).toBeInTheDocument();
  },
};
