import { describe, expect, it } from "vitest";
import {
  type BuilderProofInput,
  type ProofCommand,
  type ProofCommandResult,
  verifyBuilderProofWithRunner,
} from "./activities";

const CHECKED_AT = new Date("2026-06-19T00:00:00.000Z");
const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

describe("verifyBuilderProofWithRunner", () => {
  it("classifies complete builder proof when git facts and gates pass", async () => {
    const result = await verifyBuilderProofWithRunner(baseInput(), fakeRunner(), CHECKED_AT);

    expect(result).toEqual(
      expect.objectContaining({
        ticketId: "www-3agy.7",
        classification: "complete",
        readyForReview: true,
        checkedAt: "2026-06-19T00:00:00.000Z",
      }),
    );
    expect(result.checks.map((check) => [check.name, check.status])).toEqual([
      ["builder-output", "passed"],
      ["branch-exists", "passed"],
      ["commit-exists", "passed"],
      ["pushed-branch", "passed"],
      ["worktree-clean", "passed"],
      ["gate:test", "passed"],
      ["gate:typecheck", "passed"],
    ]);
  });

  it("classifies incomplete builder proof before review when output is missing", async () => {
    const result = await verifyBuilderProofWithRunner(
      baseInput({ builderOutput: { summary: "", changedFiles: [] } }),
      fakeRunner(),
      CHECKED_AT,
    );

    expect(result.classification).toBe("incomplete");
    expect(result.readyForReview).toBe(false);
    expect(result.checks[0]).toEqual(
      expect.objectContaining({
        name: "builder-output",
        status: "failed",
        detail: "builder output missing summary, changedFiles",
      }),
    );
  });

  it("classifies dirty when the worktree has uncommitted changes", async () => {
    const result = await verifyBuilderProofWithRunner(
      baseInput(),
      fakeRunner({ statusStdout: " M products/project-management/temporal/activities.ts\n" }),
      CHECKED_AT,
    );

    expect(result.classification).toBe("dirty");
    expect(result.readyForReview).toBe(false);
    expect(result.checks.find((check) => check.name === "worktree-clean")).toEqual(
      expect.objectContaining({ status: "failed", detail: "worktree has uncommitted changes" }),
    );
  });

  it("classifies missing-commit when the builder commit cannot be verified", async () => {
    const result = await verifyBuilderProofWithRunner(
      baseInput(),
      fakeRunner({ missingCommit: true }),
      CHECKED_AT,
    );

    expect(result.classification).toBe("missing-commit");
    expect(result.readyForReview).toBe(false);
    expect(result.checks.find((check) => check.name === "commit-exists")).toEqual(
      expect.objectContaining({ status: "failed", detail: `commit ${COMMIT_SHA} does not exist` }),
    );
  });

  it("classifies gate-failed when an AC gate command exits non-zero", async () => {
    const result = await verifyBuilderProofWithRunner(
      baseInput(),
      fakeRunner({ failedGate: "typecheck" }),
      CHECKED_AT,
    );

    expect(result.classification).toBe("gate-failed");
    expect(result.readyForReview).toBe(false);
    expect(result.checks.find((check) => check.name === "gate:typecheck")).toEqual(
      expect.objectContaining({ status: "failed", exitCode: 1, stderr: "typecheck failed" }),
    );
  });

  it("keeps command construction explicit and shell-free", async () => {
    const commands: ProofCommand[] = [];
    await verifyBuilderProofWithRunner(
      baseInput(),
      async (command) => {
        commands.push(command);
        return fakeRunner()(command);
      },
      CHECKED_AT,
    );

    expect(commands).toEqual([
      {
        name: "git",
        args: [
          "-C",
          "/repo/.claude/worktrees/www-3agy-ticket-workflow",
          "rev-parse",
          "--verify",
          "refs/heads/www-3agy-ticket-workflow",
        ],
      },
      {
        name: "git",
        args: [
          "-C",
          "/repo/.claude/worktrees/www-3agy-ticket-workflow",
          "rev-parse",
          "--verify",
          `${COMMIT_SHA}^{commit}`,
        ],
      },
      {
        name: "git",
        args: [
          "-C",
          "/repo/.claude/worktrees/www-3agy-ticket-workflow",
          "ls-remote",
          "--heads",
          "origin",
          "www-3agy-ticket-workflow",
        ],
      },
      {
        name: "git",
        args: ["-C", "/repo/.claude/worktrees/www-3agy-ticket-workflow", "status", "--porcelain"],
      },
      {
        name: "bun",
        args: ["run", "test"],
        cwd: "/repo/products/project-management",
      },
      {
        name: "bun",
        args: ["run", "typecheck"],
        cwd: "/repo/products/project-management",
      },
    ]);
  });
});

function baseInput(overrides: Partial<BuilderProofInput> = {}): BuilderProofInput {
  return {
    ticketId: "www-3agy.7",
    worktreePath: "/repo/.claude/worktrees/www-3agy-ticket-workflow",
    branch: "www-3agy-ticket-workflow",
    commitSha: COMMIT_SHA,
    requirePushedBranch: true,
    builderOutput: {
      summary: "Implemented deterministic proof activities.",
      changedFiles: ["products/project-management/temporal/activities.ts"],
    },
    gates: [
      {
        label: "test",
        command: "bun",
        args: ["run", "test"],
        cwd: "/repo/products/project-management",
      },
      {
        label: "typecheck",
        command: "bun",
        args: ["run", "typecheck"],
        cwd: "/repo/products/project-management",
      },
    ],
    ...overrides,
  };
}

function fakeRunner(
  options: {
    readonly statusStdout?: string;
    readonly missingCommit?: boolean;
    readonly failedGate?: string;
  } = {},
) {
  return async (command: ProofCommand): Promise<ProofCommandResult> => {
    if (
      command.name === "git" &&
      command.args.includes(`${COMMIT_SHA}^{commit}`) &&
      options.missingCommit
    ) {
      return fail("missing commit");
    }
    if (command.name === "git" && command.args.includes(`${COMMIT_SHA}^{commit}`)) {
      return pass(`${COMMIT_SHA}\n`);
    }
    if (command.name === "git" && command.args.includes("ls-remote")) {
      return pass(`${COMMIT_SHA}\trefs/heads/www-3agy-ticket-workflow\n`);
    }
    if (command.name === "git" && command.args.includes("status")) {
      return pass(options.statusStdout ?? "");
    }
    if (command.name === "bun" && command.args[1] === options.failedGate) {
      return fail(`${options.failedGate} failed`);
    }

    return pass("");
  };
}

function pass(stdout: string): ProofCommandResult {
  return { exitCode: 0, stdout, stderr: "" };
}

function fail(stderr: string): ProofCommandResult {
  return { exitCode: 1, stdout: "", stderr };
}
