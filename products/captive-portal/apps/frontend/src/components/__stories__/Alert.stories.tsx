import type { Meta, StoryObj } from "@storybook/react-vite";
import { Alert } from "../Alert";

const meta: Meta<typeof Alert> = {
  title: "Captive Portal/Alert",
  component: Alert,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Inline destructive alert, the only alert variant (success is a whole screen, by design). Sits at the top of the form it relates to. role=alert so it’s announced.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof Alert>;

export const NetworkError: Story = {
  name: "Couldn’t connect",
  render: () => (
    <div style={{ width: 360 }}>
      <Alert title="Couldn’t connect.">
        The network didn’t respond. Check you’re in range and try again.
      </Alert>
    </div>
  ),
};

export const WithoutTitle: Story = {
  render: () => (
    <div style={{ width: 360 }}>
      <Alert>That code didn’t match. Check the digits and try again.</Alert>
    </div>
  ),
};
