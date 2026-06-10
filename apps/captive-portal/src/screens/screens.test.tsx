import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AlreadyConnected } from "./AlreadyConnected";
import { Connecting } from "./Connecting";
import { GenericError } from "./GenericError";
import { LandingBare } from "./Landing";
import { RateLimited } from "./RateLimited";
import { Sending } from "./Sending";
import { SessionExpired } from "./SessionExpired";
import { Success } from "./Success";
import { Terms } from "./Terms";
import { Verify } from "./Verify";
import { WifiPassword } from "./WifiPassword";

const noop = () => {};
const emptyForm = { name: "", email: "", agreed: false };

describe("LandingBare", () => {
  const props = {
    state: emptyForm,
    errors: {},
    networkError: false,
    busy: false,
    onChange: noop,
    onSubmit: noop,
    onOpenTerms: noop,
  };

  it("renders the bare heading verbatim and NO sub line (screens.jsx is truth)", () => {
    render(<LandingBare {...props} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Hey there.");
    expect(h1).toHaveTextContent("Let’s get you online.");
    // bare ships with no sub paragraph
    expect(screen.queryByText(/Two quick fields/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pop in your details/)).not.toBeInTheDocument();
  });

  it("has name + email fields and a terms checkbox", () => {
    render(<LandingBare {...props} />);
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("submit button reads 'Connect to Wi-Fi', 'Connecting…' when busy", () => {
    const { rerender } = render(<LandingBare {...props} />);
    expect(screen.getByRole("button", { name: "Connect to Wi-Fi" })).toBeInTheDocument();
    rerender(<LandingBare {...props} busy />);
    expect(screen.getByRole("button", { name: "Connecting…" })).toBeInTheDocument();
  });

  it("fires onChange when typing name, onSubmit on submit", async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(<LandingBare {...props} onChange={onChange} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Name"), "J");
    expect(onChange).toHaveBeenCalledWith("name", "J");
    await userEvent.click(screen.getByRole("button", { name: "Connect to Wi-Fi" }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it("renders a form-level terms error with role=alert (CheckboxRow error is the form's job)", () => {
    render(
      <LandingBare {...props} errors={{ agreed: "You must accept the terms to continue." }} />,
    );
    const alerts = screen.getAllByRole("alert");
    expect(
      alerts.some((a) => a.textContent?.includes("You must accept the terms to continue.")),
    ).toBe(true);
  });

  it("shows a network error alert when networkError", () => {
    render(<LandingBare {...props} networkError />);
    expect(screen.getByText(/Couldn’t connect\./)).toBeInTheDocument();
  });

  it("terms link calls onOpenTerms", async () => {
    const onOpenTerms = vi.fn();
    render(<LandingBare {...props} onOpenTerms={onOpenTerms} />);
    await userEvent.click(screen.getByRole("link", { name: /terms of use/ }));
    expect(onOpenTerms).toHaveBeenCalled();
  });
});

describe("Sending", () => {
  it("shows 'Sending your code' + the email", () => {
    render(<Sending email="john@example.com" />);
    expect(screen.getByRole("heading", { name: "Sending your code" })).toBeInTheDocument();
    expect(screen.getByText("It’s on its way to your inbox.")).toBeInTheDocument();
    expect(screen.getByText("john@example.com")).toBeInTheDocument();
  });
});

describe("Verify", () => {
  const props = { email: "john@example.com", onVerify: noop, onResend: noop, onBack: noop };

  it("renders 'Check your email' + the destination email", () => {
    render(<Verify {...props} />);
    expect(screen.getByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByText("john@example.com")).toBeInTheDocument();
  });

  it("shows 'Incorrect code.' alert on a wrong-code error", () => {
    render(<Verify {...props} error="That code didn’t match. Check the digits and try again." />);
    expect(screen.getByText("Incorrect code.")).toBeInTheDocument();
  });

  it("shows 'Code expired.' alert when expired", () => {
    render(<Verify {...props} expired error="This code is no longer valid, request a new one." />);
    expect(screen.getByText("Code expired.")).toBeInTheDocument();
  });

  it("resend is a live countdown then enables; clicking it calls onResend", async () => {
    const onResend = vi.fn();
    render(<Verify {...props} onResend={onResend} initialLeft={0} />);
    const btn = screen.getByRole("button", { name: "Resend code" });
    await userEvent.click(btn);
    expect(onResend).toHaveBeenCalled();
  });

  it("countdown shows 'Resend in {n}s' while waiting", () => {
    render(<Verify {...props} initialLeft={30} />);
    expect(screen.getByText(/Resend in 30s/)).toBeInTheDocument();
  });

  it("back link 'Use a different email' calls onBack", async () => {
    const onBack = vi.fn();
    render(<Verify {...props} onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("WifiPassword", () => {
  const props = { onSubmit: noop, onBack: noop };

  it("renders heading + host sub", () => {
    render(<WifiPassword {...props} />);
    expect(screen.getByRole("heading", { name: "Enter the Wi-Fi password" })).toBeInTheDocument();
    expect(
      screen.getByText("Ask your host for the password to access this network."),
    ).toBeInTheDocument();
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
  it("step 1 reads 'Checking the password' (screens.jsx truth, not 'Authenticating')", () => {
    render(<Connecting email="john@example.com" />);
    expect(screen.getByRole("heading", { name: "Getting you online" })).toBeInTheDocument();
    expect(screen.getByText(/Checking the password/)).toBeInTheDocument();
  });
});

describe("Success", () => {
  it("greets by first name and offers Start browsing", () => {
    render(<Success name="John Appleseed" email="john@example.com" onPrimary={noop} />);
    expect(screen.getByRole("heading", { name: "You’re online, John." })).toBeInTheDocument();
    expect(screen.getByText(/Your browser should redirect automatically/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start browsing" })).toBeInTheDocument();
  });

  it("falls back to 'friend' when name is blank", () => {
    render(<Success name="" email="x@y.co" onPrimary={noop} />);
    expect(screen.getByRole("heading", { name: "You’re online, friend." })).toBeInTheDocument();
  });
});

describe("AlreadyConnected", () => {
  it("renders the already-online copy + actions", () => {
    render(<AlreadyConnected email="john@example.com" onPrimary={noop} onReset={noop} />);
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
  it("renders the 5 sections + back button", async () => {
    const onBack = vi.fn();
    render(<Terms onBack={onBack} />);
    expect(screen.getByRole("heading", { name: "Terms of use" })).toBeInTheDocument();
    expect(screen.getByText("A friendly network")).toBeInTheDocument();
    expect(screen.getByText("No warranty")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
