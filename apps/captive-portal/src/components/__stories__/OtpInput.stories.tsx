import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { OtpInput } from "../OtpInput";

const meta: Meta<typeof OtpInput> = {
  title: "Captive Portal/OtpInput",
  component: OtpInput,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Six digit boxes that behave as one field — auto-advance, paste-to-fill, backspace, arrow-key nav, numeric-only — built on shadcn `input-otp`. The first box is autocomplete=one-time-code so iOS/Android SMS autofill works. Fires onComplete when all six are filled.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof OtpInput>;

function Live({
  initial = "",
  error,
  disabled,
}: {
  initial?: string;
  error?: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div style={{ width: 320 }}>
      <OtpInput value={value} onChange={setValue} error={error} disabled={disabled} />
    </div>
  );
}

export const Empty: Story = { render: () => <Live /> };
export const Partial: Story = { render: () => <Live initial="1234" /> };
export const Complete: Story = { render: () => <Live initial="348192" /> };
export const ErrorState: Story = {
  name: "Error · wrong / expired",
  render: () => <Live initial="000000" error />,
};
export const Disabled: Story = { render: () => <Live initial="3481" disabled /> };
