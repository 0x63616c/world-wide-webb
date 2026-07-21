import type { Meta, StoryObj } from "@storybook/react-vite";
import type { InputHTMLAttributes } from "react";
import { expect, within } from "storybook/test";
import { Icon } from "../Icon";
import { Field, fieldErrorId } from "./Field";

// Field only renders the label + error-message slot; the consuming control is
// responsible for wiring aria-invalid/aria-describedby off fieldErrorId(id) ,
// mirroring the captive-portal TextInput. This bare input stands in for any
// real control (cc's TextInput is a different, valueless-id shape).
function StoryInput({
  id,
  error,
  ...rest
}: { id: string; error?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      id={id}
      aria-invalid={error || undefined}
      aria-describedby={error ? fieldErrorId(id) : undefined}
      style={{
        width: "100%",
        height: 40,
        padding: error ? "0 12px 0 36px" : "0 12px",
        borderRadius: 10,
        border: `1px solid ${error ? "var(--red, #e5484d)" : "var(--hair-2)"}`,
        background: "var(--nest)",
        color: "var(--ink)",
        fontFamily: "var(--ui)",
        fontSize: 14,
      }}
      {...rest}
    />
  );
}

const meta = {
  title: "UI/Field",
  component: Field,
  tags: ["autodocs"],
  // Every story below supplies its own `render`, so this placeholder child
  // (Field requires one) never actually renders.
  args: { id: "f-email", label: "Email", children: null },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Field {...args}>
      <StoryInput id={args.id} placeholder="you@example.com" />
    </Field>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText("Email")).toBe(canvas.getByRole("textbox"));
  },
};

export const WithIcon: Story = {
  args: { icon: <Icon name="wifi" s={16} /> },
  render: (args) => (
    <Field {...args}>
      <StoryInput id={args.id} placeholder="you@example.com" />
    </Field>
  ),
};

export const Optional: Story = {
  args: { id: "f-name", label: "Name", optional: true },
  render: (args) => (
    <Field {...args}>
      <StoryInput id={args.id} placeholder="e.g. John Appleseed" />
    </Field>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/optional/)).toBeInTheDocument();
  },
};

export const ErrorState: Story = {
  name: "Error",
  args: { error: "That doesn't look like a valid email address." },
  render: (args) => (
    <Field {...args}>
      <StoryInput id={args.id} error defaultValue="john@" />
    </Field>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alert = canvas.getByRole("alert");
    await expect(alert).toHaveAttribute("id", "f-email-error");
    const input = canvas.getByRole("textbox");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAttribute("aria-describedby", "f-email-error");
  },
};
