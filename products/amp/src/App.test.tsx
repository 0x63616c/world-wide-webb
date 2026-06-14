import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("AMP shell", () => {
  it("renders the minimal Application Management Plane shell", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Application Management Plane" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("AMP")).toHaveLength(2);
    expect(screen.getByText("app.amp.worldwidewebb.co")).toBeInTheDocument();
    expect(
      screen.getByText("No platform operations are wired into AMP v0 yet."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("amp-empty-state")).toHaveTextContent(
      "This shell is intentionally stateless",
    );
  });

  it("does not invent operational metrics", () => {
    render(<App />);

    expect(screen.queryByText(/deploys? today/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/healthy products/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/uptime/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\b\d+%\b/)).not.toBeInTheDocument();
  });
});
