import type { Meta, StoryObj } from "@storybook/react-vite";
import { Verify } from "../Verify";

const noop = () => {};
const meta: Meta<typeof Verify> = {
  title: "Captive Portal/Screens/Verify",
  component: Verify,
  tags: ["autodocs"],
  args: { email: "john@example.com", onVerify: noop, onResend: noop, onBack: noop },
  parameters: {
    docs: {
      description: {
        component:
          "6-digit email verification. States: awaiting, entered, wrong code, expired code, resend-available, code-resent. Wrong vs expired are distinct alerts.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof Verify>;

export const Awaiting: Story = { args: { initialLeft: 30 } };
export const Entered: Story = { args: { initialCode: "348192", initialLeft: 14 } };
export const WrongCode: Story = {
  name: "Error · wrong code",
  args: { error: "That code didn’t match. Check the digits and try again.", initialLeft: 9 },
};
export const Expired: Story = {
  name: "Error · expired",
  args: {
    expired: true,
    error: "This code is no longer valid, request a new one.",
    initialLeft: 0,
  },
};
export const ResendAvailable: Story = { args: { initialLeft: 0 } };
export const CodeResent: Story = { args: { initialResent: true, initialLeft: 30 } };
export const Verifying: Story = {
  name: "Busy · verifying",
  args: { initialCode: "348192", busy: true },
};
