/**
 * Design-round stories for the Guest Wi-Fi QR modal , three QR treatments
 * (crisp / rounded / accent). The payload is a placeholder network, never the real
 * guest credentials; the real value comes from the api at runtime.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { modalDocsParameters } from "../__stories__/factory";
import { GuestWifiQrModal } from "./GuestWifiQrModal";

const STORY_QR = "WIFI:T:WPA;S:storybook-guest;P:storybook-password;;";

const meta = {
  title: "Modals/GuestWifiQrModal",
  component: GuestWifiQrModal,
  tags: ["autodocs"],
  parameters: { ...modalDocsParameters(640), boardWrapper: false },
  args: { open: true, onClose: () => {}, qrValue: STORY_QR },
} satisfies Meta<typeof GuestWifiQrModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Rounded: Story = {
  args: { qrStyle: "rounded" },
  play: async () => {
    const body = within(document.body);
    await expect(body.getByText("Guest Wi-Fi")).toBeInTheDocument();
    await expect(body.getByRole("img", { name: "Guest Wi-Fi QR code" })).toBeInTheDocument();
  },
};

export const Crisp: Story = {
  args: { qrStyle: "crisp" },
};

export const Accent: Story = {
  args: { qrStyle: "accent" },
};

export const Apple: Story = {
  args: { qrStyle: "apple" },
};
