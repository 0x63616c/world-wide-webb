import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field } from "../Field";
import { MailIcon, UserIcon } from "../icons";
import { TextInput } from "../TextInput";

const meta: Meta<typeof Field> = {
  title: "Captive Portal/Field & TextInput",
  component: Field,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A labelled control with an optional leading icon, an error-message slot, and a 3px focus ring. The same Field wraps name, email and password inputs. Error sets aria-invalid + aria-describedby and renders a role=alert message.",
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof Field>;

export const Default: Story = {
  render: () => (
    <div style={{ width: 360 }}>
      <Field id="d-email" label="Email" icon={<MailIcon />}>
        <TextInput id="d-email" icon placeholder="you@example.com" />
      </Field>
    </div>
  ),
};

export const Filled: Story = {
  render: () => (
    <div style={{ width: 360 }}>
      <Field id="f-email" label="Email" icon={<MailIcon />}>
        <TextInput id="f-email" icon defaultValue="john@example.com" />
      </Field>
    </div>
  ),
};

export const ErrorState: Story = {
  name: "Error",
  render: () => (
    <div style={{ width: 360 }}>
      <Field
        id="e-email"
        label="Email"
        icon={<MailIcon />}
        error="That doesn’t look like a valid email address."
      >
        <TextInput id="e-email" icon error defaultValue="john@" />
      </Field>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div style={{ width: 360 }}>
      <Field id="x-email" label="Email" icon={<MailIcon />}>
        <TextInput id="x-email" icon disabled defaultValue="john@example.com" />
      </Field>
    </div>
  ),
};

export const NoIcon: Story = {
  name: "No icon",
  render: () => (
    <div style={{ width: 360 }}>
      <Field id="n-name" label="Name">
        <TextInput id="n-name" placeholder="e.g. John Appleseed" />
      </Field>
    </div>
  ),
};

export const Optional: Story = {
  render: () => (
    <div style={{ width: 360 }}>
      <Field id="o-name" label="Name" optional icon={<UserIcon />}>
        <TextInput id="o-name" icon placeholder="e.g. John Appleseed" />
      </Field>
    </div>
  ),
};
