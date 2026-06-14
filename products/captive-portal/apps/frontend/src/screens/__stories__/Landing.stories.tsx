import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { LandingFormState } from "@/lib/validate";
import { LandingBare, LandingCentered, type LandingProps, LandingSplit } from "../Landing";

const noop = () => {};

// Live wrapper so the form is interactive in the canvas.
function useLanding(initial: Partial<LandingFormState> = {}, opts: Partial<LandingProps> = {}) {
  const [state, setState] = useState<LandingFormState>({
    name: "",
    email: "",
    agreed: false,
    ...initial,
  });
  return {
    state,
    errors: opts.errors ?? {},
    networkError: opts.networkError ?? false,
    busy: opts.busy ?? false,
    onChange: (k: keyof LandingFormState, v: string | boolean) =>
      setState((s) => ({ ...s, [k]: v })),
    onSubmit: noop,
    onOpenTerms: noop,
  };
}

const meta: Meta<typeof LandingBare> = {
  title: "Captive Portal/Screens/Landing",
  component: LandingBare,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Landing. BARE is the shipped variant (no card, no sub line). Centered + Split are alternative treatments kept as stories only. Terms-checkbox error renders at form level (role=alert), not inside the row.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof LandingBare>;

export const Bare: Story = {
  name: "Bare (shipped) · empty",
  render: () => <LandingBare {...useLanding()} />,
};
export const BareFilled: Story = {
  name: "Bare · filled",
  render: () => (
    <LandingBare
      {...useLanding({ name: "John Appleseed", email: "john@example.com", agreed: true })}
    />
  ),
};
export const BareErrors: Story = {
  name: "Bare · validation errors",
  render: () => (
    <LandingBare
      {...useLanding(
        {},
        {
          errors: {
            name: "Please enter your name.",
            email: "That doesn’t look like a valid email address.",
            agreed: "You must accept",
          },
        },
      )}
    />
  ),
};
export const BareNetworkError: Story = {
  name: "Bare · network error",
  render: () => (
    <LandingBare
      {...useLanding(
        { name: "John Appleseed", email: "john@example.com", agreed: true },
        { networkError: true },
      )}
    />
  ),
};
export const BareSubmitting: Story = {
  name: "Bare · submitting",
  render: () => (
    <LandingBare
      {...useLanding(
        { name: "John Appleseed", email: "john@example.com", agreed: true },
        { busy: true },
      )}
    />
  ),
};
export const Centered: Story = {
  name: "Centered (stories only)",
  render: () => <LandingCentered {...useLanding()} />,
};
export const Split: Story = {
  name: "Split hero (stories only)",
  render: () => <LandingSplit {...useLanding()} />,
};
