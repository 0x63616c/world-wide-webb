import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  AlertIcon,
  ArrowLeft,
  ArrowRight,
  CheckIcon,
  GlobeMark,
  LockIcon,
  Logo,
  MailIcon,
  UserIcon,
  WifiIcon,
} from "../icons";

const meta: Meta<typeof Logo> = {
  title: "Captive Portal/Logo & Icons",
  component: Logo,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The GlobeMark logo inside the gradient .wwb-mark square (size prop), plus the full design icon set. All icons are decorative (aria-hidden) and inherit color via currentColor + size from their container.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof Logo>;

export const Default: Story = { args: { size: 44 } };
export const Large: Story = { args: { size: 48 } };

const icons = [
  ["GlobeMark", GlobeMark],
  ["MailIcon", MailIcon],
  ["UserIcon", UserIcon],
  ["AlertIcon", AlertIcon],
  ["CheckIcon", CheckIcon],
  ["ArrowLeft", ArrowLeft],
  ["ArrowRight", ArrowRight],
  ["WifiIcon", WifiIcon],
  ["LockIcon", LockIcon],
] as const;

export const IconSet: Story = {
  name: "Icon set",
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
      {icons.map(([name, Icon]) => (
        <div
          key={name}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            width: 64,
          }}
        >
          <span style={{ width: 24, height: 24, color: "var(--foreground)" }}>
            <Icon />
          </span>
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--faint-foreground)",
            }}
          >
            {name}
          </span>
        </div>
      ))}
    </div>
  ),
};
