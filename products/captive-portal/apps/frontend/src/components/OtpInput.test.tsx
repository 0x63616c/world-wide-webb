import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OtpInput } from "./OtpInput";

// input-otp schedules a selection-sync setTimeout that it never clears on
// unmount; if it fires after the jsdom env is torn down it throws
// `window is not defined` as an UNHANDLED error and fails the run even though
// every test passes. Drive these tests on fake timers (auto-advanced so
// userEvent still works) and flush + drop all pending timers on teardown, so no
// stray timer escapes the test environment. (Pre-existing flake; fixed here.)
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.clearAllTimers();
  vi.useRealTimers();
});

// A controlled harness mirrors how the Verify screen drives the OTP.
function Harness({
  onComplete,
  error,
  disabled,
  initial = "",
}: {
  onComplete?: (v: string) => void;
  error?: boolean;
  disabled?: boolean;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <OtpInput
      value={value}
      onChange={setValue}
      onComplete={onComplete}
      error={error}
      disabled={disabled}
    />
  );
}

describe("OtpInput", () => {
  it("renders a single textbox with one-time-code autocomplete + numeric mode", () => {
    render(<Harness />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("inputmode", "numeric");
  });

  it("renders 6 digit slots", () => {
    const { container } = render(<Harness />);
    expect(container.querySelectorAll(".wwb-otp-box")).toHaveLength(6);
  });

  it("accepts typed digits and fires onComplete once all six are entered", async () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "348192");
    expect(onComplete).toHaveBeenCalledWith("348192");
  });

  it("strips non-numeric characters (numeric-only)", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "1a2b3c");
    expect(input).toHaveValue("123");
  });

  it("supports paste of a 6-digit code", async () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    const input = screen.getByRole("textbox");
    input.focus();
    await userEvent.paste("654321");
    expect(input).toHaveValue("654321");
    expect(onComplete).toHaveBeenCalledWith("654321");
  });

  it("backspace removes the last digit", async () => {
    render(<Harness initial="1234" />);
    const input = screen.getByRole("textbox");
    input.focus();
    await userEvent.keyboard("{Backspace}");
    expect(input).toHaveValue("123");
  });

  it("marks every slot in error when error is set", () => {
    const { container } = render(<Harness error initial="000000" />);
    const boxes = container.querySelectorAll(".wwb-otp-box.is-error");
    expect(boxes).toHaveLength(6);
  });

  it("fills slots get the is-filled class", () => {
    const { container } = render(<Harness initial="12" />);
    expect(container.querySelectorAll(".wwb-otp-box.is-filled")).toHaveLength(2);
  });

  it("disabled prevents input", async () => {
    const onComplete = vi.fn();
    render(<Harness disabled onComplete={onComplete} />);
    const input = screen.getByRole("textbox");
    expect(input).toBeDisabled();
    await userEvent.type(input, "123456");
    expect(onComplete).not.toHaveBeenCalled();
  });
});
