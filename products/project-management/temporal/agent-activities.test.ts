import { describe, expect, it } from "vitest";
import {
  buildTicketBuilderPrompt,
  buildTicketMergeFixPrompt,
  buildTicketReviewerPrompt,
  formatTicketReviewerFindings,
  parseTicketReviewerVerdict,
  startTicketBuilder,
  startTicketMergeFix,
  startTicketReviewer,
  TICKET_BUILDER_AGENT,
  TICKET_BUILDER_MODEL,
  TICKET_MERGEFIX_AGENT,
  TICKET_MERGEFIX_MODEL,
  TICKET_REVIEWER_AGENT,
  TICKET_REVIEWER_MODEL,
  type TicketBuilderPrompt,
  type TicketMergeFixPrompt,
  type TicketReviewerPrompt,
} from "./agent-activities";
import type { ActivityCommand, ActivityCommandRunner } from "./command-activities";

describe("ticket builder activity", () => {
  it("builds a prompt that forbids ticket closure and requires ticket context", () => {
    const prompt = buildTicketBuilderPrompt(baseInput());

    expect(prompt.promptPath).toBe("/cache/logs/ticket_www-3agy.9_build_1.prompt.md");
    expect(prompt.prompt).toContain("Run `bd show www-3agy.9` before editing");
    expect(prompt.prompt).toContain("- [ ] Builder uses explicit OpenCode agent/model");
    expect(prompt.prompt).toContain("Never close Beads tickets");
    expect(prompt.prompt).toContain("Do not run `bd close`");
    expect(prompt.prompt).toContain("Commit and push the ticket branch");
    expect(prompt.prompt).toContain("revert that file before committing");
  });

  it("archives the prompt and starts opencode in tmux with explicit agent and model", async () => {
    const prompts: TicketBuilderPrompt[] = [];
    const commands: ActivityCommand[] = [];
    const result = await startTicketBuilder(
      baseInput(),
      async (prompt) => {
        prompts.push(prompt);
      },
      fakeRunner(commands),
    );

    expect(prompts).toHaveLength(1);
    expect(result).toEqual(
      expect.objectContaining({
        agent: TICKET_BUILDER_AGENT,
        model: TICKET_BUILDER_MODEL,
        sessionName: "ticket_www-3agy.9_build_1",
        promptPath: "/cache/logs/ticket_www-3agy.9_build_1.prompt.md",
      }),
    );
    expect(commands[1]).toEqual({
      command: "tmux",
      args: [
        "new-session",
        "-d",
        "-s",
        "ticket_www-3agy.9_build_1",
        "-c",
        "/repo/.worktrees/tickets/www-3agy.9-builder",
        "('opencode' 'run' '--dangerously-skip-permissions' '--agent' 'ticket-builder' '--model' 'openai/gpt-5.5' 'Follow the attached ticket-builder prompt exactly.' '--file' '/cache/logs/ticket_www-3agy.9_build_1.prompt.md' > '/cache/logs/ticket_www-3agy.9_build_1.stdout.log' 2> '/cache/logs/ticket_www-3agy.9_build_1.stderr.log'); printf '%s' \"$?\" > '/cache/logs/ticket_www-3agy.9_build_1.exitcode'",
      ],
    });
  });
});

describe("ticket merge-fix activity", () => {
  it("builds a bounded prompt in the merge worktree context", () => {
    const prompt = buildTicketMergeFixPrompt(mergeFixInput());

    expect(prompt.promptPath).toBe("/cache/logs/ticket_www-3agy.12_mergefix_1.prompt.md");
    expect(prompt.prompt).toContain("Merge worktree: /repo");
    expect(prompt.prompt).toContain("Failed deterministic step: final-gates");
    expect(prompt.prompt).toContain("final-gate:test");
    expect(prompt.prompt).toContain(
      "Leave the worktree ready for the deterministic merge workflow to rerun final gates",
    );
    expect(prompt.prompt).toContain("Keep the fix bounded to this attempt");
    expect(prompt.prompt).toContain("Do not push, commit unrelated work, close Beads tickets");
  });

  it("archives the prompt and starts opencode in tmux with the merge-fix agent", async () => {
    const prompts: TicketMergeFixPrompt[] = [];
    const commands: ActivityCommand[] = [];
    const result = await startTicketMergeFix(
      mergeFixInput(),
      async (prompt) => {
        prompts.push(prompt);
      },
      fakeRunner(commands),
    );

    expect(prompts).toHaveLength(1);
    expect(result).toEqual(
      expect.objectContaining({
        agent: TICKET_MERGEFIX_AGENT,
        model: TICKET_MERGEFIX_MODEL,
        sessionName: "ticket_www-3agy.12_mergefix_1",
        promptPath: "/cache/logs/ticket_www-3agy.12_mergefix_1.prompt.md",
      }),
    );
    expect(commands[1]).toEqual({
      command: "tmux",
      args: [
        "new-session",
        "-d",
        "-s",
        "ticket_www-3agy.12_mergefix_1",
        "-c",
        "/repo",
        "('opencode' 'run' '--dangerously-skip-permissions' '--agent' 'ticket-mergefix' '--model' 'openai/gpt-5.5' 'Follow the attached ticket-mergefix prompt exactly.' '--file' '/cache/logs/ticket_www-3agy.12_mergefix_1.prompt.md' > '/cache/logs/ticket_www-3agy.12_mergefix_1.stdout.log' 2> '/cache/logs/ticket_www-3agy.12_mergefix_1.stderr.log'); printf '%s' \"$?\" > '/cache/logs/ticket_www-3agy.12_mergefix_1.exitcode'",
      ],
    });
  });
});

describe("ticket reviewer activity", () => {
  it("builds a prompt with ticket, comments, branch, worktree, acceptance criteria, and no-merge rules", () => {
    const prompt = buildTicketReviewerPrompt(reviewerInput());

    expect(prompt.promptPath).toBe("/cache/logs/ticket_www-3agy.10_review_1.prompt.md");
    expect(prompt.prompt).toMatchInlineSnapshot(`
      "# Ticket Reviewer

      Ticket: www-3agy.10 - Implement OpenCode reviewer Activity
      Attempt: 1
      Branch: www-3agy.10-implement-opencode-reviewer-activity
      Worktree: /repo/.worktrees/tickets/www-3agy.10-reviewer

      ## Required Reading

      - Run \`bd show www-3agy.10\` and read the ticket description, labels, comments, and acceptance criteria.
      - Inspect the implementation in branch \`www-3agy.10-implement-opencode-reviewer-activity\` from worktree \`/repo/.worktrees/tickets/www-3agy.10-reviewer\`.
      - Review the builder commit delta with \`git diff HEAD^..HEAD\` and \`git show --stat --oneline HEAD\`. Do not use \`origin/main...HEAD\`, because ticket branches are based on the orchestration branch and that compares the whole epic.
      - Do not rely on builder summaries.
      - Verify every acceptance criterion below with observed evidence.

      ## Acceptance Criteria

      - [ ] Reviewer uses explicit cheaper model/agent by default

      ## Existing Comments

      Builder summary: changed agent-activities.ts.

      ## Hard Rules

      - Do not edit files.
      - Do not merge.
      - Do not close Beads tickets. Do not run \`bd close\`.
      - Do not commit or push.
      - Run only focused, non-destructive checks when needed.

      ## Required Beads Handoff

      Your final action is Beads state, not printed JSON. Leave a Beads comment headed \`## Reviewer findings\` with findings and acceptance evidence, then move the ticket to exactly ONE outcome label:

      - Pass: \`bd update www-3agy.10 --add-label ticket-verified --remove-label ticket-review --remove-label ticket-ready --remove-label ticket-retry\`
      - Changes needed: \`bd update www-3agy.10 --add-label ticket-retry --remove-label ticket-review --remove-label ticket-verified\`
      - Human needed: \`bd update www-3agy.10 --add-label ticket-human --remove-label ticket-review --remove-label ticket-ready --remove-label ticket-verified --remove-label ticket-retry\`

      Do not print a verdict JSON object. The workflow verifies Beads labels/comments directly with \`verifyReviewerHandoffActivity\`.
      "
    `);
  });

  it("archives the prompt and starts opencode in tmux with explicit reviewer agent and cheaper model", async () => {
    const prompts: TicketReviewerPrompt[] = [];
    const commands: ActivityCommand[] = [];
    const result = await startTicketReviewer(
      reviewerInput(),
      async (prompt) => {
        prompts.push(prompt);
      },
      fakeRunner(commands),
    );

    expect(prompts).toHaveLength(1);
    expect(result).toEqual(
      expect.objectContaining({
        agent: TICKET_REVIEWER_AGENT,
        model: TICKET_REVIEWER_MODEL,
        sessionName: "ticket_www-3agy.10_review_1",
        promptPath: "/cache/logs/ticket_www-3agy.10_review_1.prompt.md",
      }),
    );
    expect(commands[1]).toEqual({
      command: "tmux",
      args: [
        "new-session",
        "-d",
        "-s",
        "ticket_www-3agy.10_review_1",
        "-c",
        "/repo/.worktrees/tickets/www-3agy.10-reviewer",
        "('opencode' 'run' '--dangerously-skip-permissions' '--agent' 'ticket-reviewer' '--model' 'openai/gpt-5.5-fast' 'Follow the attached ticket-reviewer prompt exactly.' '--file' '/cache/logs/ticket_www-3agy.10_review_1.prompt.md' > '/cache/logs/ticket_www-3agy.10_review_1.stdout.log' 2> '/cache/logs/ticket_www-3agy.10_review_1.stderr.log'); printf '%s' \"$?\" > '/cache/logs/ticket_www-3agy.10_review_1.exitcode'",
      ],
    });
  });

  it("parses pass, fail, and human reviewer verdicts from structured output", () => {
    expect(
      parseTicketReviewerVerdict(
        JSON.stringify({
          verdict: "pass",
          summary: "All criteria verified.",
          findings: [],
          acceptanceEvidence: ["model: opencode command includes openai/gpt-5.5-fast"],
        }),
      ).verdict,
    ).toBe("pass");

    expect(
      parseTicketReviewerVerdict(
        `\n\`\`\`json\n${JSON.stringify({
          verdict: "fail",
          summary: "Reviewer findings need a comment.",
          findings: [
            {
              severity: "major",
              file: "products/project-management/beads-adapter.ts",
              line: 10,
              message: "No requeue command exists.",
            },
          ],
          acceptanceEvidence: ["failed review requeue: missing"],
        })}\n\`\`\`\n`,
      ),
    ).toEqual(
      expect.objectContaining({
        verdict: "fail",
        findings: [expect.objectContaining({ severity: "major" })],
      }),
    );

    expect(
      parseTicketReviewerVerdict(
        JSON.stringify({
          verdict: "human",
          summary: "Needs Calum to decide whether AC changed.",
          findings: [],
          acceptanceEvidence: ["human decision required"],
        }),
      ).verdict,
    ).toBe("human");

    expect(
      parseTicketReviewerVerdict(
        [
          JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
          JSON.stringify({
            type: "tool_use",
            part: {
              type: "tool",
              state: {
                output: JSON.stringify({
                  verdict: "pass",
                  summary: "Verified from command output.",
                  findings: [],
                  acceptanceEvidence: ["printed by reviewer command"],
                }),
              },
            },
          }),
        ].join("\n"),
      ).verdict,
    ).toBe("pass");
  });

  it("rejects malformed reviewer verdicts at the parser boundary", () => {
    expect(() =>
      parseTicketReviewerVerdict(
        JSON.stringify({ verdict: "maybe", summary: "bad", findings: [], acceptanceEvidence: [] }),
      ),
    ).toThrow("reviewer output did not contain a verdict JSON object");
  });

  it("formats structured reviewer findings for the Beads comment boundary", () => {
    expect(
      formatTicketReviewerFindings({
        verdict: "fail",
        summary: "One AC is missing.",
        findings: [
          {
            severity: "blocker",
            file: "products/project-management/temporal/agent-activities.ts",
            line: 123,
            message: "Reviewer does not use the cheaper model.",
          },
        ],
        acceptanceEvidence: ["model AC: failed"],
      }),
    ).toMatchInlineSnapshot(`
      "Verdict: fail

      One AC is missing.

      ## Findings

      - blocker: products/project-management/temporal/agent-activities.ts:123 - Reviewer does not use the cheaper model.

      ## Acceptance evidence

      - model AC: failed"
    `);
  });
});

function baseInput() {
  return {
    ticketId: "www-3agy.9",
    title: "Implement OpenCode builder Activity",
    worktreePath: "/repo/.worktrees/tickets/www-3agy.9-builder",
    attempt: 1,
    acceptanceCriteria: "- [ ] Builder uses explicit OpenCode agent/model",
    comments: ["Previous reviewer asked for more tests."],
    runtimeLogRoot: "/cache/logs",
  };
}

function reviewerInput() {
  return {
    ticketId: "www-3agy.10",
    title: "Implement OpenCode reviewer Activity",
    branch: "www-3agy.10-implement-opencode-reviewer-activity",
    worktreePath: "/repo/.worktrees/tickets/www-3agy.10-reviewer",
    attempt: 1,
    acceptanceCriteria: "- [ ] Reviewer uses explicit cheaper model/agent by default",
    comments: ["Builder summary: changed agent-activities.ts."],
    runtimeLogRoot: "/cache/logs",
  };
}

function mergeFixInput() {
  return {
    ticketId: "www-3agy.12",
    title: "Implement merge-fix agent fallback",
    repoRoot: "/repo",
    branch: "www-3agy.12-implement-merge-fix-agent-fallback",
    attempt: 1,
    failedStep: "final-gates",
    failureRecords: [
      {
        activity: "final-gate:test",
        command: { command: "bun", args: ["run", "test"], cwd: "/repo" },
        exitCode: 1,
        stdout: "",
        stderr: "test failed",
      },
    ],
    finalGates: [{ label: "test", command: "bun", args: ["run", "test"] }],
    acceptanceCriteria: "- [ ] Deterministic gates rerun after merge-fix",
    comments: ["Reviewer found a deterministic gate failure."],
    runtimeLogRoot: "/cache/logs",
  };
}

function fakeRunner(commands: ActivityCommand[]): ActivityCommandRunner {
  return async (command) => {
    commands.push(command);
    return { exitCode: 0, stdout: "", stderr: "" };
  };
}
