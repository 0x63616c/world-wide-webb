import { Context } from "@temporalio/activity";

export type ProjectSnapshot = {
  readonly issueCount: number;
  readonly loadedAt: string;
};

export async function loadProjectSnapshot(): Promise<ProjectSnapshot> {
  const activityType = Context.current().info.activityType;
  throw new Error(
    `Beads adapter is intentionally not implemented in www-3agy.5 (${activityType}); shell/git/bd I/O belongs in this Activity boundary.`,
  );
}

export type ProofCommand = {
  readonly name: string;
  readonly args: readonly string[];
  readonly cwd?: string;
};

export type ProofCommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type ProofCommandRunner = (command: ProofCommand) => Promise<ProofCommandResult>;

export type GateCommandInput = {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
};

export type BuilderProofInput = {
  readonly ticketId: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly commitSha: string | null;
  readonly requirePushedBranch: boolean;
  readonly builderOutput: {
    readonly summary: string;
    readonly changedFiles: readonly string[];
  };
  readonly gates: readonly GateCommandInput[];
};

export const BUILDER_PROOF_CLASSIFICATIONS = [
  "complete",
  "incomplete",
  "dirty",
  "missing-commit",
  "gate-failed",
] as const;

export type BuilderProofClassification = (typeof BUILDER_PROOF_CLASSIFICATIONS)[number];

export type ProofCheckStatus = "passed" | "failed" | "skipped";

export type ProofCheck = {
  readonly name: string;
  readonly status: ProofCheckStatus;
  readonly detail: string;
  readonly command?: ProofCommand;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
};

export type BuilderProofResult = {
  readonly ticketId: string;
  readonly classification: BuilderProofClassification;
  readonly readyForReview: boolean;
  readonly checkedAt: string;
  readonly branch: string;
  readonly commitSha: string | null;
  readonly checks: readonly ProofCheck[];
};

export async function verifyBuilderProof(input: BuilderProofInput): Promise<BuilderProofResult> {
  return verifyBuilderProofWithRunner(input, defaultProofCommandRunner, new Date());
}

export async function verifyBuilderProofWithRunner(
  input: BuilderProofInput,
  runCommand: ProofCommandRunner,
  checkedAt: Date,
): Promise<BuilderProofResult> {
  const checks: ProofCheck[] = [];
  const builderOutputCheck = checkBuilderOutput(input);
  checks.push(builderOutputCheck);

  const branchCheck = await runGitCheck(
    {
      name: "git",
      args: ["-C", input.worktreePath, "rev-parse", "--verify", `refs/heads/${input.branch}`],
    },
    runCommand,
    "branch-exists",
    `branch ${input.branch} exists`,
    `branch ${input.branch} does not exist`,
  );
  checks.push(branchCheck);

  const commitCheck = await checkCommit(input, runCommand);
  checks.push(commitCheck);

  const pushedBranchCheck = await checkPushedBranch(input, commitCheck, runCommand);
  checks.push(pushedBranchCheck);

  const cleanlinessCheck = await checkWorktreeClean(input, runCommand);
  checks.push(cleanlinessCheck);

  for (const gate of input.gates) {
    checks.push(await runGate(gate, runCommand));
  }

  const classification = classifyProof(checks);
  return {
    ticketId: input.ticketId,
    classification,
    readyForReview: classification === "complete",
    checkedAt: checkedAt.toISOString(),
    branch: input.branch,
    commitSha: input.commitSha,
    checks,
  };
}

function checkBuilderOutput(input: BuilderProofInput): ProofCheck {
  const missing: string[] = [];
  if (input.builderOutput.summary.trim().length === 0) missing.push("summary");
  if (input.builderOutput.changedFiles.length === 0) missing.push("changedFiles");
  if (input.branch.trim().length === 0) missing.push("branch");
  if (input.worktreePath.trim().length === 0) missing.push("worktreePath");

  if (missing.length > 0) {
    return {
      name: "builder-output",
      status: "failed",
      detail: `builder output missing ${missing.join(", ")}`,
    };
  }

  return {
    name: "builder-output",
    status: "passed",
    detail: "builder output is complete enough for deterministic proof",
  };
}

async function checkCommit(
  input: BuilderProofInput,
  runCommand: ProofCommandRunner,
): Promise<ProofCheck> {
  if (input.commitSha === null || input.commitSha.trim().length === 0) {
    return {
      name: "commit-exists",
      status: "failed",
      detail: "builder did not report a commit sha",
    };
  }

  return runGitCheck(
    {
      name: "git",
      args: ["-C", input.worktreePath, "rev-parse", "--verify", `${input.commitSha}^{commit}`],
    },
    runCommand,
    "commit-exists",
    `commit ${input.commitSha} exists`,
    `commit ${input.commitSha} does not exist`,
  );
}

async function checkPushedBranch(
  input: BuilderProofInput,
  commitCheck: ProofCheck,
  runCommand: ProofCommandRunner,
): Promise<ProofCheck> {
  if (!input.requirePushedBranch) {
    return {
      name: "pushed-branch",
      status: "skipped",
      detail: "pushed branch is not required",
    };
  }
  if (commitCheck.status !== "passed" || input.commitSha === null) {
    return {
      name: "pushed-branch",
      status: "skipped",
      detail: "commit must exist before pushed branch can be verified",
    };
  }
  const resolvedCommitSha = commitCheck.stdout?.trim() || input.commitSha;

  const command = {
    name: "git",
    args: ["-C", input.worktreePath, "ls-remote", "--heads", "origin", input.branch],
  } as const satisfies ProofCommand;
  const result = await runCommand(command);
  const remoteHead = parseRemoteHead(result.stdout, input.branch);
  const matchesCommit = remoteHead === resolvedCommitSha;

  return {
    name: "pushed-branch",
    status: result.exitCode === 0 && matchesCommit ? "passed" : "failed",
    detail:
      result.exitCode === 0 && matchesCommit
        ? `origin/${input.branch} points at ${resolvedCommitSha}`
        : `origin/${input.branch} does not point at ${resolvedCommitSha}`,
    command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function checkWorktreeClean(
  input: BuilderProofInput,
  runCommand: ProofCommandRunner,
): Promise<ProofCheck> {
  const command = {
    name: "git",
    args: ["-C", input.worktreePath, "status", "--porcelain"],
  } as const satisfies ProofCommand;
  const result = await runCommand(command);
  const clean = result.exitCode === 0 && result.stdout.trim().length === 0;

  return {
    name: "worktree-clean",
    status: clean ? "passed" : "failed",
    detail: clean ? "worktree is clean" : "worktree has uncommitted changes",
    command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function runGate(
  gate: GateCommandInput,
  runCommand: ProofCommandRunner,
): Promise<ProofCheck> {
  const command = {
    name: gate.command,
    args: gate.args,
    cwd: gate.cwd,
  } as const satisfies ProofCommand;
  const result = await runCommand(command);

  return {
    name: `gate:${gate.label}`,
    status: result.exitCode === 0 ? "passed" : "failed",
    detail: result.exitCode === 0 ? "gate passed" : "gate failed",
    command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function runGitCheck(
  command: ProofCommand,
  runCommand: ProofCommandRunner,
  name: string,
  passedDetail: string,
  failedDetail: string,
): Promise<ProofCheck> {
  const result = await runCommand(command);
  return {
    name,
    status: result.exitCode === 0 ? "passed" : "failed",
    detail: result.exitCode === 0 ? passedDetail : failedDetail,
    command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseRemoteHead(stdout: string, branch: string): string | null {
  const ref = `refs/heads/${branch}`;
  const line = stdout
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.endsWith(ref));
  return line?.split(/\s+/)[0] ?? null;
}

function classifyProof(checks: readonly ProofCheck[]): BuilderProofClassification {
  if (checks.some((check) => check.name === "builder-output" && check.status === "failed")) {
    return "incomplete";
  }
  if (checks.some((check) => check.name === "commit-exists" && check.status === "failed")) {
    return "missing-commit";
  }
  if (checks.some((check) => check.name === "worktree-clean" && check.status === "failed")) {
    return "dirty";
  }
  if (checks.some((check) => check.name.startsWith("gate:") && check.status === "failed")) {
    return "gate-failed";
  }
  if (checks.some((check) => check.status === "failed")) return "incomplete";
  return "complete";
}

async function defaultProofCommandRunner(command: ProofCommand): Promise<ProofCommandResult> {
  const process = Bun.spawn([command.name, ...command.args], {
    cwd: command.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return { exitCode, stdout, stderr };
}
