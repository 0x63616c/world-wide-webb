import { join } from "node:path";
import { ApplicationFailure } from "@temporalio/activity";
import {
  type ActivityCommandRunner,
  type ActivityRecord,
  type FinalGateCommand,
  type StartTmuxCommandResult,
  startTmuxCommand,
} from "./command-activities";

export const TICKET_BUILDER_AGENT = "ticket-builder";
export const TICKET_BUILDER_MODEL = "openai/gpt-5.5";
export const TICKET_REVIEWER_AGENT = "ticket-reviewer";
export const TICKET_REVIEWER_MODEL = "openai/gpt-5.5-fast";
export const TICKET_MERGEFIX_AGENT = "ticket-mergefix";
export const TICKET_MERGEFIX_MODEL = "openai/gpt-5.5";

export const TICKET_REVIEWER_VERDICTS = ["pass", "fail", "human"] as const;

export type TicketReviewerVerdictKind = (typeof TICKET_REVIEWER_VERDICTS)[number];

export type TicketBuilderInput = {
  readonly ticketId: string;
  readonly title: string;
  readonly worktreePath: string;
  readonly attempt: number;
  readonly acceptanceCriteria: string;
  readonly comments: readonly string[];
  readonly runtimeLogRoot?: string;
  readonly resumeSessionId?: string;
};

export type TicketBuilderPrompt = {
  readonly prompt: string;
  readonly promptPath: string;
};

export type TicketBuilderActivityResult = StartTmuxCommandResult & {
  readonly agent: typeof TICKET_BUILDER_AGENT;
  readonly model: typeof TICKET_BUILDER_MODEL;
  readonly promptPath: string;
};

export type TicketReviewerInput = {
  readonly ticketId: string;
  readonly title: string;
  readonly branch: string;
  readonly worktreePath: string;
  readonly attempt: number;
  readonly acceptanceCriteria: string;
  readonly comments: readonly string[];
  readonly runtimeLogRoot?: string;
  readonly resumeSessionId?: string;
};

export type TicketReviewerPrompt = {
  readonly prompt: string;
  readonly promptPath: string;
};

export type TicketReviewerActivityResult = StartTmuxCommandResult & {
  readonly agent: typeof TICKET_REVIEWER_AGENT;
  readonly model: typeof TICKET_REVIEWER_MODEL;
  readonly promptPath: string;
};

export type TicketMergeFixInput = {
  readonly ticketId: string;
  readonly title: string;
  readonly repoRoot: string;
  readonly branch: string;
  readonly attempt: number;
  readonly failedStep: string;
  readonly failureRecords: readonly ActivityRecord[];
  readonly finalGates: readonly FinalGateCommand[];
  readonly acceptanceCriteria: string;
  readonly comments: readonly string[];
  readonly runtimeLogRoot?: string;
};

export type TicketMergeFixPrompt = {
  readonly prompt: string;
  readonly promptPath: string;
};

export type TicketMergeFixActivityResult = StartTmuxCommandResult & {
  readonly agent: typeof TICKET_MERGEFIX_AGENT;
  readonly model: typeof TICKET_MERGEFIX_MODEL;
  readonly promptPath: string;
};

export type TicketReviewerFinding = {
  readonly severity: "blocker" | "major" | "minor";
  readonly file: string | null;
  readonly line: number | null;
  readonly message: string;
};

export type TicketReviewerVerdict = {
  readonly verdict: TicketReviewerVerdictKind;
  readonly summary: string;
  readonly findings: readonly TicketReviewerFinding[];
  readonly acceptanceEvidence: readonly string[];
};

export async function startTicketBuilderActivity(
  input: TicketBuilderInput,
): Promise<TicketBuilderActivityResult> {
  return startTicketBuilder(input, defaultPromptWriter, undefined);
}

export async function startTicketBuilder(
  input: TicketBuilderInput,
  writePrompt: (prompt: TicketBuilderPrompt) => Promise<void>,
  runCommand?: ActivityCommandRunner,
): Promise<TicketBuilderActivityResult> {
  const prompt = buildTicketBuilderPrompt(input);
  await writePrompt(prompt);
  const tmuxResult = await startTmuxCommand(
    {
      ticketId: input.ticketId,
      kind: "build",
      attempt: input.attempt,
      cwd: input.worktreePath,
      runtimeLogRoot: input.runtimeLogRoot,
      command: [
        "opencode",
        "run",
        "--dangerously-skip-permissions",
        ...(input.resumeSessionId ? ["--session", input.resumeSessionId] : []),
        "--agent",
        TICKET_BUILDER_AGENT,
        "--model",
        TICKET_BUILDER_MODEL,
        "Follow the attached ticket-builder prompt exactly.",
        "--file",
        prompt.promptPath,
      ],
    },
    runCommand ?? defaultActivityCommandRunner,
  );

  return {
    ...tmuxResult,
    agent: TICKET_BUILDER_AGENT,
    model: TICKET_BUILDER_MODEL,
    promptPath: prompt.promptPath,
  };
}

export async function startTicketReviewerActivity(
  input: TicketReviewerInput,
): Promise<TicketReviewerActivityResult> {
  return startTicketReviewer(input, defaultPromptWriter, undefined);
}

export async function startTicketMergeFixActivity(
  input: TicketMergeFixInput,
): Promise<TicketMergeFixActivityResult> {
  return startTicketMergeFix(input, defaultPromptWriter, undefined);
}

export async function parseTicketReviewerVerdictActivity(
  output: string,
): Promise<TicketReviewerVerdict> {
  return parseTicketReviewerVerdict(output);
}

export async function startTicketReviewer(
  input: TicketReviewerInput,
  writePrompt: (prompt: TicketReviewerPrompt) => Promise<void>,
  runCommand?: ActivityCommandRunner,
): Promise<TicketReviewerActivityResult> {
  const prompt = buildTicketReviewerPrompt(input);
  await writePrompt(prompt);
  const tmuxResult = await startTmuxCommand(
    {
      ticketId: input.ticketId,
      kind: "review",
      attempt: input.attempt,
      cwd: input.worktreePath,
      runtimeLogRoot: input.runtimeLogRoot,
      command: [
        "opencode",
        "run",
        "--dangerously-skip-permissions",
        ...(input.resumeSessionId ? ["--session", input.resumeSessionId] : []),
        "--agent",
        TICKET_REVIEWER_AGENT,
        "--model",
        TICKET_REVIEWER_MODEL,
        "Follow the attached ticket-reviewer prompt exactly.",
        "--file",
        prompt.promptPath,
      ],
    },
    runCommand ?? defaultActivityCommandRunner,
  );

  return {
    ...tmuxResult,
    agent: TICKET_REVIEWER_AGENT,
    model: TICKET_REVIEWER_MODEL,
    promptPath: prompt.promptPath,
  };
}

export async function startTicketMergeFix(
  input: TicketMergeFixInput,
  writePrompt: (prompt: TicketMergeFixPrompt) => Promise<void>,
  runCommand?: ActivityCommandRunner,
): Promise<TicketMergeFixActivityResult> {
  const prompt = buildTicketMergeFixPrompt(input);
  await writePrompt(prompt);
  const tmuxResult = await startTmuxCommand(
    {
      ticketId: input.ticketId,
      kind: "mergefix",
      attempt: input.attempt,
      cwd: input.repoRoot,
      runtimeLogRoot: input.runtimeLogRoot,
      command: [
        "opencode",
        "run",
        "--dangerously-skip-permissions",
        "--agent",
        TICKET_MERGEFIX_AGENT,
        "--model",
        TICKET_MERGEFIX_MODEL,
        "Follow the attached ticket-mergefix prompt exactly.",
        "--file",
        prompt.promptPath,
      ],
    },
    runCommand ?? defaultActivityCommandRunner,
  );

  return {
    ...tmuxResult,
    agent: TICKET_MERGEFIX_AGENT,
    model: TICKET_MERGEFIX_MODEL,
    promptPath: prompt.promptPath,
  };
}

export function buildTicketBuilderPrompt(input: TicketBuilderInput): TicketBuilderPrompt {
  const promptPath = join(
    input.runtimeLogRoot ?? ".tickets/logs",
    `ticket_${input.ticketId}_build_${input.attempt}.prompt.md`,
  );
  const commentBlock =
    input.comments.length > 0 ? input.comments.join("\n\n---\n\n") : "No comments.";

  return {
    promptPath,
    prompt: `# Ticket Builder\n\nTicket: ${input.ticketId} - ${input.title}\nAttempt: ${input.attempt}${input.resumeSessionId ? " (same OpenCode session retry)" : ""}\n\n## Required Reading\n\nRun \`bd show ${input.ticketId}\` before editing. Read ticket comments and relevant project instructions before changing files.\n\n## Acceptance Criteria\n\n${input.acceptanceCriteria}\n\n## Existing Comments\n\n${commentBlock}\n\n## Hard Rules\n\n- Work only in this worktree: ${input.worktreePath}\n- Build the smallest correct implementation that satisfies the acceptance criteria.\n- Commit and push the ticket branch when implementation is complete. If commit signing fails because the local 1Password signing agent has no identity, retry the same commit with \`--no-gpg-sign\` and report that in the handoff.\n- If OpenCode changes \`.opencode/package.json\` as a tool self-update side effect, revert that file before committing.\n- Leave a Beads handoff comment headed \`## Builder summary\` with changed files, commit SHA, pushed branch, and verification.\n- Move the ticket to review with \`bd update ${input.ticketId} --add-label ticket-review --remove-label ticket-ready --remove-label ticket-verified --remove-label ticket-retry --remove-label ticket-human --remove-label ticket-shipped\`.\n- Never close Beads tickets. Do not run \`bd close\`, do not mark the ticket complete, and do not merge to main.\n`,
  };
}

export function buildTicketReviewerPrompt(input: TicketReviewerInput): TicketReviewerPrompt {
  const promptPath = join(
    input.runtimeLogRoot ?? ".tickets/logs",
    `ticket_${input.ticketId}_review_${input.attempt}.prompt.md`,
  );
  const commentBlock =
    input.comments.length > 0 ? input.comments.join("\n\n---\n\n") : "No comments.";

  return {
    promptPath,
    prompt: `# Ticket Reviewer

Ticket: ${input.ticketId} - ${input.title}
Attempt: ${input.attempt}${input.resumeSessionId ? " (same OpenCode session retry)" : ""}
Branch: ${input.branch}
Worktree: ${input.worktreePath}

## Required Reading

- Run \`bd show ${input.ticketId}\` and read the ticket description, labels, comments, and acceptance criteria.
- Inspect the implementation in branch \`${input.branch}\` from worktree \`${input.worktreePath}\`.
- Review the builder commit delta with \`git diff HEAD^..HEAD\` and \`git show --stat --oneline HEAD\`. Do not use \`origin/main...HEAD\`, because ticket branches are based on the orchestration branch and that compares the whole epic.
- Do not rely on builder summaries.
- Verify every acceptance criterion below with observed evidence.

## Acceptance Criteria

${input.acceptanceCriteria}

## Existing Comments

${commentBlock}

## Hard Rules

- Do not edit files.
- Do not merge.
- Do not close Beads tickets. Do not run \`bd close\`.
- Do not commit or push.
- Run only focused, non-destructive checks when needed.

## Required Beads Handoff

Your final action is Beads state, not printed JSON. Leave a Beads comment headed \`## Reviewer findings\` with findings and acceptance evidence, then move the ticket to exactly ONE outcome label:

- Pass: \`bd update ${input.ticketId} --add-label ticket-verified --remove-label ticket-ready --remove-label ticket-review --remove-label ticket-retry --remove-label ticket-human --remove-label ticket-shipped\`
- Changes needed: \`bd update ${input.ticketId} --add-label ticket-retry --remove-label ticket-ready --remove-label ticket-review --remove-label ticket-verified --remove-label ticket-human --remove-label ticket-shipped\`
- Human needed: \`bd update ${input.ticketId} --add-label ticket-human --remove-label ticket-ready --remove-label ticket-review --remove-label ticket-verified --remove-label ticket-retry --remove-label ticket-shipped\`

Do not print a verdict JSON object. The workflow verifies Beads labels/comments directly with \`verifyReviewerHandoffActivity\`.
`,
  };
}

export function buildTicketMergeFixPrompt(input: TicketMergeFixInput): TicketMergeFixPrompt {
  const promptPath = join(
    input.runtimeLogRoot ?? ".tickets/logs",
    `ticket_${input.ticketId}_mergefix_${input.attempt}.prompt.md`,
  );
  const commentBlock =
    input.comments.length > 0 ? input.comments.join("\n\n---\n\n") : "No comments.";
  const failureBlock =
    input.failureRecords.length > 0
      ? input.failureRecords.map(formatActivityRecord).join("\n\n")
      : "No command records were captured.";
  const gateBlock = input.finalGates
    .map((gate) => `- ${gate.label}: ${[gate.command, ...gate.args].join(" ")}`)
    .join("\n");

  return {
    promptPath,
    prompt: `# Ticket Merge Fix

Ticket: ${input.ticketId} - ${input.title}
Attempt: ${input.attempt}
Branch: ${input.branch}
Merge worktree: ${input.repoRoot}
Failed deterministic step: ${input.failedStep}

## Required Reading

- Run \`bd show ${input.ticketId}\` and read the ticket description, labels, comments, and acceptance criteria.
- Inspect the current merge/worktree state in \`${input.repoRoot}\`. The deterministic merge workflow has already failed and left this worktree as the repair context.
- Review the failure records below before editing.

## Acceptance Criteria

${input.acceptanceCriteria}

## Existing Comments

${commentBlock}

## Failed Command Records

${failureBlock}

## Deterministic Gates That Will Rerun

${gateBlock || "- No final gates configured"}

## Hard Rules

- Work only in this merge/worktree context: ${input.repoRoot}
- Fix only the merge conflict or post-merge gate failure that blocks this merge.
- Leave the worktree ready for the deterministic merge workflow to rerun final gates.
- Do not push, commit unrelated work, close Beads tickets, or run \`bd close\`.
- Do not remove tests or weaken gates to make the merge pass.
- Keep the fix bounded to this attempt; if the correct repair is unclear, report that human input is needed.
`,
  };
}

export function parseTicketReviewerVerdict(output: string): TicketReviewerVerdict {
  for (const candidate of reviewerVerdictCandidates(output)) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isTicketReviewerVerdict(parsed)) return parsed;
    } catch {
      // Keep scanning, opencode --format json emits an event stream, not a single payload.
    }
  }
  throw ApplicationFailure.nonRetryable(
    "reviewer output did not contain a verdict JSON object",
    "InvalidReviewerOutput",
  );
}

export function formatTicketReviewerFindings(verdict: TicketReviewerVerdict): string {
  const findings =
    verdict.findings.length > 0 ? verdict.findings.map(formatReviewerFinding).join("\n") : "- None";
  const evidence =
    verdict.acceptanceEvidence.length > 0
      ? verdict.acceptanceEvidence.map((entry) => `- ${entry}`).join("\n")
      : "- No acceptance evidence reported";

  return `Verdict: ${verdict.verdict}

${verdict.summary}

## Findings

${findings}

## Acceptance evidence

${evidence}`;
}

function formatActivityRecord(record: ActivityRecord): string {
  return `### ${record.activity}

Command: ${[record.command.command, ...record.command.args].join(" ")}
Exit: ${record.exitCode}
Stdout:
${record.stdout || "(empty)"}
Stderr:
${record.stderr || "(empty)"}`;
}

function extractJsonObject(output: string): string {
  const trimmed = output.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(trimmed);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("reviewer output did not contain a JSON object");
  }
  return trimmed.slice(start, end + 1);
}

function reviewerVerdictCandidates(output: string): string[] {
  const candidates: string[] = [];
  collectTextCandidates(output, candidates);

  for (const line of output.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    candidates.push(trimmed);
    try {
      collectJsonStrings(JSON.parse(trimmed), candidates);
    } catch {
      // Formatted output lines often are not JSON events.
    }
  }

  return candidates;
}

function collectJsonStrings(value: unknown, candidates: string[]): void {
  if (typeof value === "string") {
    collectTextCandidates(value, candidates);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonStrings(item, candidates);
    return;
  }
  if (!value || typeof value !== "object") return;
  candidates.push(JSON.stringify(value));
  for (const nested of Object.values(value)) collectJsonStrings(nested, candidates);
}

function collectTextCandidates(text: string, candidates: string[]): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  candidates.push(trimmed);
  for (const line of trimmed.split(/\r?\n/).reverse()) {
    const candidate = line.trim();
    if (!candidate) continue;
    candidates.push(candidate);
    try {
      candidates.push(extractJsonObject(candidate));
    } catch {
      // A text line may be normal transcript output.
    }
  }
}

function isTicketReviewerVerdict(value: unknown): value is TicketReviewerVerdict {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    isReviewerVerdict(candidate.verdict) &&
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.findings) &&
    candidate.findings.every(isTicketReviewerFinding) &&
    Array.isArray(candidate.acceptanceEvidence) &&
    candidate.acceptanceEvidence.every((entry) => typeof entry === "string")
  );
}

function isTicketReviewerFinding(value: unknown): value is TicketReviewerFinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    isReviewerFindingSeverity(candidate.severity) &&
    (typeof candidate.file === "string" || candidate.file === null) &&
    (typeof candidate.line === "number" || candidate.line === null) &&
    typeof candidate.message === "string"
  );
}

function isReviewerVerdict(value: unknown): value is TicketReviewerVerdictKind {
  return TICKET_REVIEWER_VERDICTS.some((verdict) => verdict === value);
}

function isReviewerFindingSeverity(value: unknown): value is TicketReviewerFinding["severity"] {
  return value === "blocker" || value === "major" || value === "minor";
}

function formatReviewerFinding(finding: TicketReviewerFinding): string {
  const location = finding.file
    ? `${finding.file}${finding.line === null ? "" : `:${finding.line}`}`
    : "no file";
  return `- ${finding.severity}: ${location} - ${finding.message}`;
}

async function defaultPromptWriter(
  prompt: TicketBuilderPrompt | TicketReviewerPrompt | TicketMergeFixPrompt,
): Promise<void> {
  await Bun.write(prompt.promptPath, prompt.prompt);
}

async function defaultActivityCommandRunner(command: Parameters<ActivityCommandRunner>[0]) {
  const proc = Bun.spawn([command.command, ...command.args], {
    cwd: command.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: command.env ? { ...Bun.env, ...command.env } : undefined,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}
