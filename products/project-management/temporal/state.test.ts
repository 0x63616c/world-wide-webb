import { describe, expect, it } from "vitest";
import { issueTransitionWorkflow } from "./workflows";

describe("issueTransitionWorkflow", () => {
  it("applies a deterministic state transition without activity I/O", async () => {
    await expect(
      issueTransitionWorkflow({
        issueId: "www-3agy.5",
        state: "ready",
        event: { type: "claim" },
      }),
    ).resolves.toEqual({
      issueId: "www-3agy.5",
      previousState: "ready",
      nextState: "in_progress",
    });
  });
});
