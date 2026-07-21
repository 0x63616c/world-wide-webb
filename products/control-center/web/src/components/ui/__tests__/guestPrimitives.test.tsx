/**
 * Ported from products/captive-portal/apps/frontend/src/components/primitives.test.tsx
 * and Field.reflow.test.tsx , coverage for the four shared ui primitives added
 * for the guest bundle (Button, Alert, Field, CheckboxRow). Restyled onto cc
 * tokens; behavior + aria wiring ported verbatim.
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Alert } from "../Alert";
import { Button } from "../Button";
import { CheckboxRow } from "../CheckboxRow";
import { Field, fieldErrorId } from "../Field";

describe("Button", () => {
  it("renders as a button with the given label", () => {
    render(<Button>Connect</Button>);
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("renders the ghost variant", () => {
    render(<Button variant="ghost">Back</Button>);
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("loading disables the button and shows a spinner while keeping the label (a11y)", () => {
    const { container } = render(<Button loading>Connecting…</Button>);
    const btn = screen.getByRole("button", { name: "Connecting…" });
    expect(btn).toBeDisabled();
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
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

  it("defaults to type=submit so it drives native form submission", () => {
    render(<Button>Connect</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });
});

describe("Field", () => {
  it("associates the label with the input via htmlFor/id", () => {
    render(
      <Field id="f-email" label="Email">
        <input id="f-email" type="text" />
      </Field>,
    );
    expect(screen.getByLabelText("Email")).toBe(screen.getByRole("textbox"));
  });

  it("renders an optional suffix when optional", () => {
    render(
      <Field id="f1" label="Name" optional>
        <input id="f1" type="text" />
      </Field>,
    );
    expect(screen.getByText(/optional/)).toBeInTheDocument();
  });

  it("error: shows a role=alert message whose id matches fieldErrorId", () => {
    render(
      <Field id="f-email" label="Email" error="That doesn't look like a valid email address.">
        <input
          id="f-email"
          type="text"
          aria-invalid="true"
          aria-describedby={fieldErrorId("f-email")}
        />
      </Field>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("That doesn't look like a valid email address.");
    expect(alert).toHaveAttribute("id", "f-email-error");
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "f-email-error");
  });

  it("no error: renders no role=alert", () => {
    render(
      <Field id="f-email" label="Email">
        <input id="f-email" type="text" />
      </Field>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("fieldErrorId derives the error id from the field id", () => {
    expect(fieldErrorId("f-email")).toBe("f-email-error");
  });
});

// www-2nrj: a field error must render on the label row (right-aligned), and the
// label row must reserve its height whether or not an error is shown, so that
// toggling an error causes ZERO reflow of the input below.
describe("Field error placement (www-2nrj, no reflow)", () => {
  it("always renders the error-slot element (present even with no error, id stable)", () => {
    const { rerender } = render(
      <Field id="f-name" label="Name">
        <input id="f-name" type="text" />
      </Field>,
    );
    const slot = document.getElementById(fieldErrorId("f-name"));
    expect(slot).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <Field id="f-name" label="Name" error="Required">
        <input id="f-name" type="text" />
      </Field>,
    );
    // Same element, now populated , the DOM node identity did not change.
    expect(document.getElementById(fieldErrorId("f-name"))).toBe(slot);
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
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

  it("error marks the checkbox aria-invalid", () => {
    render(
      <CheckboxRow id="t" checked={false} error onChange={() => {}}>
        I agree
      </CheckboxRow>,
    );
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("label is tied to the checkbox", () => {
    render(
      <CheckboxRow id="t" checked onChange={() => {}}>
        I agree to the terms
      </CheckboxRow>,
    );
    expect(screen.getByLabelText(/I agree to the terms/)).toBe(screen.getByRole("checkbox"));
  });

  it("errorMessage renders as role=alert with id matching fieldErrorId and wires describedby", () => {
    render(
      <CheckboxRow
        id="terms"
        checked={false}
        error
        errorMessage="You must accept"
        onChange={() => {}}
      >
        I agree
      </CheckboxRow>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("You must accept");
    expect(alert).toHaveAttribute("id", fieldErrorId("terms"));
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-describedby", fieldErrorId("terms"));
  });

  it("no errorMessage: renders no role=alert", () => {
    render(
      <CheckboxRow id="terms" checked={false} onChange={() => {}}>
        I agree
      </CheckboxRow>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Alert", () => {
  it("renders role=alert with a bold title and body", () => {
    render(<Alert title="Couldn't connect.">The network didn't respond.</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't connect.");
    expect(alert).toHaveTextContent("The network didn't respond.");
  });

  it("renders without a title", () => {
    render(<Alert>That code didn't match.</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("That code didn't match.");
  });
});
