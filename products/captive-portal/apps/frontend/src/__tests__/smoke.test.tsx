import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { cn } from "../lib/utils";

describe("scaffold smoke", () => {
  it("boots into the password screen (App runs the flow state machine)", () => {
    render(<App />);
    // Password-only flow (www-p9hx): the sole entry screen asks for the WiFi password.
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Enter the Wi-Fi password");
    expect(screen.getByLabelText("Wi-Fi password")).toBeInTheDocument();
  });

  it("cn() merges and dedupes tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-white", false, "font-medium")).toBe("text-white font-medium");
  });
});
