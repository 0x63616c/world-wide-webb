import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Alert } from "./Alert";

const meta = {
  title: "UI/Alert",
  component: Alert,
  tags: ["autodocs"],
  args: {
    title: "Couldn't connect.",
    children: "The network didn't respond. Check you're in range and try again.",
  },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTitle: Story = {
  play: async ({ canvasElement }) => {
    const alert = within(canvasElement).getByRole("alert");
    await expect(alert).toHaveTextContent("Couldn't connect.");
    await expect(alert).toHaveTextContent("The network didn't respond.");
  },
};

export const WithoutTitle: Story = {
  args: { title: undefined, children: "That code didn't match. Check the digits and try again." },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("alert")).toBeInTheDocument();
  },
};
