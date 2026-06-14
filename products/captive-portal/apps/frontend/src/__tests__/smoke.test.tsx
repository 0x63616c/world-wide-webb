import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { cn } from "../lib/utils";

describe("scaffold smoke", () => {
  it("boots into the landing screen (App runs the flow state machine)", () => {
    render(<App />);
    // The flow starts on landing; LandingBare's heading carries the welcome.
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Hey there.");
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("cn() merges and dedupes tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-white", false, "font-medium")).toBe("text-white font-medium");
  });
});
