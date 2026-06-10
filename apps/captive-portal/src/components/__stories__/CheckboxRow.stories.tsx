import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CheckboxRow } from "../CheckboxRow";

const meta: Meta<typeof CheckboxRow> = {
  title: "Captive Portal/CheckboxRow",
  component: CheckboxRow,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A 17px custom checkbox with an inline link to the terms. Required: the user cannot connect until it’s ticked. The inline link opens the Terms screen without losing form state; ticking the box elsewhere must not navigate.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof CheckboxRow>;

function Live({ initial, error }: { initial?: boolean; error?: boolean }) {
  const [checked, setChecked] = useState(!!initial);
  return (
    <div style={{ width: 360 }}>
      <CheckboxRow id="cb" checked={checked} error={error} onChange={setChecked}>
        I agree to the {/* biome-ignore lint/a11y/useValidAnchor: demo link, no nav in Storybook */}
        <a href="#terms" onClick={(e) => e.preventDefault()}>
          terms of use
        </a>
        .
      </CheckboxRow>
    </div>
  );
}

export const Unchecked: Story = { render: () => <Live /> };
export const Checked: Story = { render: () => <Live initial /> };
export const ErrorState: Story = { name: "Error", render: () => <Live error /> };
