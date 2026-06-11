import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "./Field";
import { TextInput } from "./TextInput";

// www-2nrj: a field error must render on the label ROW (right-aligned), and the
// label row must reserve its height whether or not an error is shown, so that
// toggling an error causes ZERO reflow of the inputs/buttons below.
describe("Field error placement (www-2nrj, no reflow)", () => {
  it("renders the error inside the label row, not as a sibling below the input", () => {
    render(
      <Field id="f-email" label="Email" error="That does not look like a valid email address.">
        <TextInput id="f-email" error />
      </Field>,
    );
    const alert = screen.getByRole("alert");
    const labelRow = alert.closest(".wwb-label-row");
    expect(labelRow).not.toBeNull();
    expect(labelRow?.querySelector(".wwb-label")).not.toBeNull();
    // The error must NOT be a direct sibling sitting after the input wrap.
    const inputWrap = document.querySelector(".wwb-input-wrap");
    expect(inputWrap?.nextElementSibling).toBeNull();
  });

  it("always renders the label row (with reserved error slot) even with no error", () => {
    const { container } = render(
      <Field id="f-name" label="Name">
        <TextInput id="f-name" />
      </Field>,
    );
    const labelRow = container.querySelector(".wwb-label-row");
    expect(labelRow).not.toBeNull();
    expect(labelRow?.querySelector(".wwb-error")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
