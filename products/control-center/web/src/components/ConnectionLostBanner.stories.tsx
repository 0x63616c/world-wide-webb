import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

// Presentational wrapper that accepts connection state as props so each story
// drives the banner without needing a real React Query context.
function BannerPreview({ isLost }: { isLost: boolean }) {
  if (!isLost) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connection-lost-banner"
      style={{
        position: "absolute",
        top: 18,
        right: 18,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderRadius: 12,
        background: "rgba(244, 192, 99, 0.1)",
        border: "1px solid rgba(244, 192, 99, 0.35)",
        color: "var(--amber, #f4c063)",
        fontSize: 13,
        fontFamily: "var(--ui, system-ui)",
        letterSpacing: "-0.01em",
        pointerEvents: "none",
        backdropFilter: "blur(6px)",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: "var(--amber, #f4c063)",
          opacity: 0.8,
          flexShrink: 0,
        }}
      />
      <span>Unable to connect…</span>
    </div>
  );
}

// Board-like container so the absolute positioning renders correctly.
function BoardStage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: 1366,
        height: 200,
        background: "#0c0e11",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

const meta = {
  title: "Components/Banners/Connection Lost",
  component: BannerPreview,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <BoardStage>
        <Story />
      </BoardStage>
    ),
  ],
} satisfies Meta<typeof BannerPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

// No banner when the connection is healthy.
export const Connected: Story = {
  args: { isLost: false },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector("[role='status']")).toBeNull();
  },
};

// Banner appears when the connection has been lost past the threshold.
export const ConnectionLost: Story = {
  args: { isLost: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toBeInTheDocument();
    await expect(canvas.getByText(/unable to connect/i)).toBeInTheDocument();
  },
};

// Reconnecting state , same visual as lost (component auto-dismisses on recovery).
export const Reconnecting: Story = {
  args: { isLost: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toBeInTheDocument();
    await expect(canvas.getByText(/unable to connect/i)).toBeInTheDocument();
  },
};
