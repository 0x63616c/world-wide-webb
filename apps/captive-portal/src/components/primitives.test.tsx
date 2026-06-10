import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { CheckboxRow } from "./CheckboxRow";
import { Field } from "./Field";
import { MailIcon } from "./icons";
import { NetworkPill } from "./NetworkPill";
import { TextInput } from "./TextInput";

describe("Button", () => {
  it("renders the primary variant by default", () => {
    render(<Button>Connect</Button>);
    const btn = screen.getByRole("button", { name: "Connect" });
    expect(btn).toHaveClass("wwb-btn", "wwb-btn-primary");
  });

  it("renders the ghost variant", () => {
    render(<Button variant="ghost">Back</Button>);
    expect(screen.getByRole("button", { name: "Back" })).toHaveClass("wwb-btn-ghost");
  });

  it("loading disables the button and shows a spinner while keeping the label (a11y)", () => {
    const { container } = render(<Button loading>Connecting…</Button>);
    const btn = screen.getByRole("button", { name: "Connecting…" });
    expect(btn).toBeDisabled();
    expect(container.querySelector(".wwb-spinner")).toBeInTheDocument();
  });

  it("explicit disabled also disables", () => {
    render(<Button disabled>Connect</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("does not fire onClick while loading (double-submit guard)", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Connecting…
      </Button>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Field + TextInput", () => {
  it("associates the label with the input via htmlFor/id", () => {
    render(
      <Field id="f-email" label="Email" icon={<MailIcon />}>
        <TextInput id="f-email" icon />
      </Field>,
    );
    // getByLabelText only resolves if the label is wired to the control.
    expect(screen.getByLabelText("Email")).toBe(screen.getByRole("textbox"));
  });

  it("renders an optional suffix when optional", () => {
    render(
      <Field id="f1" label="Name" optional>
        <TextInput id="f1" />
      </Field>,
    );
    expect(screen.getByText(/optional/)).toBeInTheDocument();
  });

  it("error: shows a role=alert message and marks the input invalid + described-by", () => {
    render(
      <Field id="f-email" label="Email" error="That doesn’t look like a valid email address.">
        <TextInput id="f-email" error />
      </Field>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("That doesn’t look like a valid email address.");
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "f-email-error");
    expect(alert).toHaveAttribute("id", "f-email-error");
  });

  it("no error: input is not aria-invalid and has no describedby", () => {
    render(
      <Field id="f-email" label="Email">
        <TextInput id="f-email" />
      </Field>,
    );
    const input = screen.getByRole("textbox");
    expect(input).not.toHaveAttribute("aria-invalid", "true");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("TextInput adds has-icon and is-error classes appropriately", () => {
    render(<TextInput id="x" icon error aria-label="x" />);
    expect(screen.getByLabelText("x")).toHaveClass("wwb-input", "has-icon", "is-error");
  });
});

describe("CheckboxRow", () => {
  it("reflects checked and fires onChange with the new boolean", async () => {
    const onChange = vi.fn();
    render(
      <CheckboxRow id="terms" checked={false} onChange={onChange}>
        I agree
      </CheckboxRow>,
    );
    const box = screen.getByRole("checkbox");
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("error tints the box (is-error class)", () => {
    render(
      <CheckboxRow id="t" checked={false} error onChange={() => {}}>
        I agree
      </CheckboxRow>,
    );
    expect(screen.getByRole("checkbox")).toHaveClass("is-error");
  });

  it("label is tied to the checkbox", () => {
    render(
      <CheckboxRow id="t" checked onChange={() => {}}>
        I agree to the terms
      </CheckboxRow>,
    );
    expect(screen.getByLabelText(/I agree to the terms/)).toBe(screen.getByRole("checkbox"));
  });
});

describe("Alert", () => {
  it("renders role=alert with a bold title and body", () => {
    render(<Alert title="Couldn’t connect.">The network didn’t respond.</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("wwb-alert", "wwb-alert-error");
    expect(alert).toHaveTextContent("Couldn’t connect.");
    expect(alert).toHaveTextContent("The network didn’t respond.");
  });
});

describe("NetworkPill", () => {
  it("never renders the word 'guest' (PRD rule); defaults to 'Wi-Fi'", () => {
    render(<NetworkPill />);
    const pill = screen.getByText("Wi-Fi");
    expect(pill).toBeInTheDocument();
    expect(pill.textContent?.toLowerCase()).not.toContain("guest");
  });

  it("accepts a custom label but is still guest-free by construction", () => {
    render(<NetworkPill label="Home Wi-Fi" />);
    expect(screen.getByText("Home Wi-Fi")).toBeInTheDocument();
  });
});
