// Ported 1:1 from products/captive-portal/apps/frontend/src/screens/screens.test.tsx
// onto the cc-primitives rebuild of the 8 guest screens (SDD track 0, task 2.5).
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AlreadyConnected } from "./AlreadyConnected";
import { Connecting } from "./Connecting";
import { GenericError } from "./GenericError";
import { RateLimited } from "./RateLimited";
import { SessionExpired } from "./SessionExpired";
import { Success } from "./Success";
import { Terms } from "./Terms";
import { WifiPassword } from "./WifiPassword";

const noop = () => {};

describe("WifiPassword (the sole entry screen, password-only)", () => {
  const props = { agreed: true, onAgreeChange: noop, onSubmit: noop, onOpenTerms: noop };

  it("renders heading + host sub + a terms checkbox", () => {
    render(<WifiPassword {...props} />);
    expect(screen.getByRole("heading", { name: "Enter the Wi-Fi password" })).toBeInTheDocument();
    expect(screen.getByText("Ask your host for the password to get online.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("show/hide toggles the input type without clearing it", async () => {
    render(<WifiPassword {...props} initialValue="secret123" />);
    const input = screen.getByLabelText("Wi-Fi password");
    expect(input).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("secret123");
  });

  it("submits the entered password", async () => {
    const onSubmit = vi.fn();
    render(<WifiPassword {...props} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Wi-Fi password"), "hunter2!");
    await userEvent.click(screen.getByRole("button", { name: "Connect to Wi-Fi" }));
    expect(onSubmit).toHaveBeenCalledWith("hunter2!");
  });

  it("Connect is disabled until the guest agrees to the terms", () => {
    render(<WifiPassword {...props} agreed={false} initialValue="hunter2!" />);
    expect(screen.getByRole("button", { name: "Connect to Wi-Fi" })).toBeDisabled();
  });

  it("the terms link calls onOpenTerms", async () => {
    const onOpenTerms = vi.fn();
    render(<WifiPassword {...props} onOpenTerms={onOpenTerms} />);
    await userEvent.click(screen.getByRole("link", { name: /terms of use/ }));
    expect(onOpenTerms).toHaveBeenCalled();
  });

  it("shows a wrong-password field error", () => {
    render(
      <WifiPassword {...props} error="That password isn’t right. Double-check with your host." />,
    );
    expect(
      screen.getByText("That password isn’t right. Double-check with your host."),
    ).toBeInTheDocument();
  });

  it("shows a network error alert", () => {
    render(<WifiPassword {...props} networkError />);
    expect(screen.getByText(/Couldn’t connect\./)).toBeInTheDocument();
  });
});

describe("Connecting", () => {
  it("step 1 reads 'Checking the password'", () => {
    render(<Connecting />);
    expect(screen.getByRole("heading", { name: "Getting you online" })).toBeInTheDocument();
    expect(screen.getByText(/Checking the password/)).toBeInTheDocument();
  });
});

describe("Success", () => {
  it("shows 'You’re online.' and offers Start browsing", () => {
    render(<Success onPrimary={noop} />);
    expect(screen.getByRole("heading", { name: "You’re online." })).toBeInTheDocument();
    expect(screen.getByText(/Your browser should redirect automatically/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start browsing" })).toBeInTheDocument();
  });
});

describe("AlreadyConnected", () => {
  it("renders the already-online copy + actions", () => {
    render(<AlreadyConnected onPrimary={noop} onReset={noop} />);
    expect(screen.getByRole("heading", { name: "You’re already online." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue browsing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Not you\? Sign in again/ })).toBeInTheDocument();
  });
});

describe("RateLimited", () => {
  it("shows 'Too many attempts' + a mm:ss countdown; Try again disabled while counting", () => {
    render(<RateLimited initialLeft={297} onRetry={noop} onReset={noop} />);
    expect(screen.getByRole("heading", { name: "Too many attempts" })).toBeInTheDocument();
    expect(screen.getByText("4:57")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
  });

  it("Try again is enabled at 0", () => {
    render(<RateLimited initialLeft={0} onRetry={noop} onReset={noop} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });
});

describe("SessionExpired", () => {
  it("renders expiry copy + reconnect", async () => {
    const onReconnect = vi.fn();
    render(<SessionExpired onReconnect={onReconnect} />);
    expect(screen.getByRole("heading", { name: "Your access has expired" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(onReconnect).toHaveBeenCalled();
  });
});

describe("GenericError", () => {
  it("renders generic copy + retry/reset", () => {
    render(<GenericError onRetry={noop} onReset={noop} />);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start over" })).toBeInTheDocument();
  });
});

describe("Terms", () => {
  it("renders the sections + back button", async () => {
    const onBack = vi.fn();
    render(<Terms onBack={onBack} />);
    expect(screen.getByRole("heading", { name: "Terms of use" })).toBeInTheDocument();
    expect(screen.getByText("A friendly network")).toBeInTheDocument();
    expect(screen.getByText("No warranty")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
