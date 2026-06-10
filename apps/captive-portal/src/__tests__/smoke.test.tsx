import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { cn } from "../lib/utils";

describe("scaffold smoke", () => {
  it("renders the boot heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Connect to Wi-Fi" })).toBeInTheDocument();
  });

  it("cn() merges and dedupes tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-white", false, "font-medium")).toBe("text-white font-medium");
  });
});
