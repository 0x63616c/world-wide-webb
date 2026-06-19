import { describe, expect, it } from "vitest";
import {
  applyTicketWorkflowEvents,
  DEFAULT_TICKET_WORKFLOW_OPTIONS,
  initialTicketWorkflowState,
  transitionTicketWorkflow,
} from "./state";
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

describe("ticketWorkflow state machine", () => {
  it("uses explicit defaults for builder and reviewer attempt limits", () => {
    expect(DEFAULT_TICKET_WORKFLOW_OPTIONS).toEqual({
      maxBuilderAttempts: 2,
      maxReviewerAttempts: 2,
    });
  });

  it("moves ready work through build, review, verified, merge, and closed phases", () => {
    expect(
      applyTicketWorkflowEvents("www-3agy.6", [
        { type: "start-build" },
        { type: "complete-step", outcome: "builder-passed" },
        { type: "complete-step", outcome: "reviewer-passed" },
        { type: "complete-step", outcome: "merge-passed" },
      ]),
    ).toEqual(
      expect.objectContaining({
        ticketId: "www-3agy.6",
        phase: "closed",
        builderAttempts: 1,
        reviewerAttempts: 1,
        terminalReason: "merged",
      }),
    );
  });

  it("distinguishes step exhaustion from timeout outcomes", () => {
    const timeout = transitionTicketWorkflow(
      { ...initialTicketWorkflowState("www-timeout"), phase: "build", builderAttempts: 2 },
      { type: "complete-step", outcome: "builder-timeout" },
    );
    const exhausted = transitionTicketWorkflow(
      { ...initialTicketWorkflowState("www-exhausted"), phase: "build", builderAttempts: 2 },
      { type: "complete-step", outcome: "builder-step-exhausted" },
    );

    expect(timeout).toEqual(
      expect.objectContaining({ phase: "human", terminalReason: "builder-timeout" }),
    );
    expect(exhausted).toEqual(
      expect.objectContaining({ phase: "human", terminalReason: "builder-step-exhausted" }),
    );
  });

  it("escalates to ticket-human phase without closing after max reviewer attempts", () => {
    const state = transitionTicketWorkflow(
      { ...initialTicketWorkflowState("www-review"), phase: "review", reviewerAttempts: 2 },
      { type: "complete-step", outcome: "reviewer-failed" },
    );

    expect(state.phase).toBe("human");
    expect(state.terminalReason).toBe("reviewer-failed");
  });

  it("routes a failed review back to builder retry instead of reviewing again", () => {
    const state = transitionTicketWorkflow(
      {
        ...initialTicketWorkflowState("www-review-retry"),
        phase: "review",
        builderAttempts: 1,
        reviewerAttempts: 1,
      },
      { type: "complete-step", outcome: "reviewer-failed" },
    );

    expect(state).toEqual(
      expect.objectContaining({
        phase: "build",
        builderAttempts: 2,
        reviewerAttempts: 1,
        lastOutcome: "reviewer-failed",
      }),
    );
  });

  it("accepts pause, resume, retry, mark-human, and cancel signals", () => {
    let state = initialTicketWorkflowState("www-controls");

    state = transitionTicketWorkflow(state, { type: "signal", signal: { type: "pause" } });
    expect(state.paused).toBe(true);

    state = transitionTicketWorkflow(state, { type: "signal", signal: { type: "resume" } });
    expect(state.paused).toBe(false);

    state = transitionTicketWorkflow(state, { type: "signal", signal: { type: "retry" } });
    expect(state).toEqual(expect.objectContaining({ phase: "build", builderAttempts: 1 }));

    state = transitionTicketWorkflow(state, {
      type: "signal",
      signal: { type: "mark-human", reason: "needs review" },
    });
    expect(state).toEqual(
      expect.objectContaining({ phase: "human", terminalReason: "needs review" }),
    );

    const cancelled = transitionTicketWorkflow(initialTicketWorkflowState("www-cancel"), {
      type: "signal",
      signal: { type: "cancel", reason: "duplicate" },
    });
    expect(cancelled).toEqual(
      expect.objectContaining({ phase: "human", terminalReason: "cancelled: duplicate" }),
    );
  });
});
