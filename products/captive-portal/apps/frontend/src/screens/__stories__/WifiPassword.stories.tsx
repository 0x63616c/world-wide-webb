import type { Meta, StoryObj } from "@storybook/react-vite";
import { WifiPassword } from "../WifiPassword";

const noop = () => {};
const meta: Meta<typeof WifiPassword> = {
  title: "Captive Portal/Screens/WifiPassword",
  component: WifiPassword,
  tags: ["autodocs"],
  args: { agreed: true, onAgreeChange: noop, onSubmit: noop, onOpenTerms: noop },
  parameters: {
    docs: {
      description: {
        component:
          "The sole entry screen (password-only portal). States: awaiting, terms not yet agreed, filled+shown, wrong password, network failure.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof WifiPassword>;

export const Awaiting: Story = {};
export const TermsNotAgreed: Story = {
  name: "Terms not agreed (submit disabled)",
  args: { agreed: false, initialValue: "guest-passw0rd" },
};
export const FilledShown: Story = {
  name: "Filled · shown",
  args: { initialValue: "guest-passw0rd", initialShow: true },
};
export const WrongPassword: Story = {
  name: "Error · wrong password",
  args: { error: "That password isn’t right. Double-check with your host." },
};
export const NetworkFailure: Story = {
  name: "Error · network",
  args: { networkError: true, initialValue: "guest-passw0rd" },
};
