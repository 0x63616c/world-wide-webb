import { readdir } from "node:fs/promises";
import { defaultRuntimeLogRoot } from "../temporal/command-activities";
import {
  planTicketArtifactCleanup,
  type TicketArtifactCleanupAction,
} from "../ticket-artifact-cleanup";

type CleanupCliOptions = {
  readonly ticketId: string;
  readonly repoRoot: string;
  readonly runtimeLogRoot: string;
  readonly execute: boolean;
  readonly removeEvidence: boolean;
  readonly killTmuxSessions: boolean;
};

const options = parseArgs(Bun.argv.slice(2));
const worktreePaths = parseWorktreePaths(
  await runText("git", ["-C", options.repoRoot, "worktree", "list", "--porcelain"]),
);
const tmuxSessions = parseLines(
  await runText("tmux", ["list-sessions", "-F", "#S"], { allowFailure: true }),
);
const evidenceFileNames = await readDirectoryNames(options.runtimeLogRoot);
const plan = planTicketArtifactCleanup({
  ticketId: options.ticketId,
  repoRoot: options.repoRoot,
  runtimeLogRoot: options.runtimeLogRoot,
  worktreePaths,
  tmuxSessions,
  evidenceFileNames,
  killTmuxSessions: options.killTmuxSessions,
  removeEvidence: options.removeEvidence,
});

printPlan(options, plan.actions, plan.reportedTmuxSessions, plan.preservedEvidencePaths);

if (options.execute) {
  for (const action of plan.actions) await executeAction(action, options.repoRoot);
} else {
  console.warn("Dry run only. Re-run with --execute to remove listed cleanup actions.");
}

function parseArgs(args: readonly string[]): CleanupCliOptions {
  const ticketId = args.find((arg) => !arg.startsWith("--"));
  if (!ticketId || args.includes("--help")) {
    printUsage();
    process.exit(ticketId ? 0 : 1);
  }

  return {
    ticketId,
    repoRoot: valueAfter(args, "--repo-root") ?? process.cwd(),
    runtimeLogRoot: valueAfter(args, "--log-root") ?? defaultRuntimeLogRoot(),
    execute: args.includes("--execute"),
    removeEvidence: args.includes("--remove-evidence"),
    killTmuxSessions: args.includes("--kill-tmux"),
  };
}

function printUsage(): void {
  console.warn(
    [
      "Usage: bun products/project-management/scripts/cleanup-ticket-artifacts.ts <ticket-id> [options]",
      "",
      "Options:",
      "  --execute           Apply cleanup actions. Default is dry-run.",
      "  --kill-tmux         Kill exact ticket workflow tmux sessions instead of only reporting them.",
      "  --remove-evidence   Remove matching prompt/log/exitcode evidence. Default preserves evidence.",
      "  --repo-root <path>  Repository root. Default is cwd.",
      "  --log-root <path>   Runtime log root. Default is the project-management cache log dir.",
    ].join("\n"),
  );
}

function valueAfter(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

async function runText(
  command: string,
  args: readonly string[],
  options?: { readonly allowFailure?: boolean },
): Promise<string> {
  const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0 && !options?.allowFailure) {
    throw new Error(stderr.trim() || `${command} exited ${exitCode}`);
  }
  return exitCode === 0 ? stdout : "";
}

function parseWorktreePaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

function parseLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readDirectoryNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function printPlan(
  options: CleanupCliOptions,
  actions: readonly TicketArtifactCleanupAction[],
  reportedTmuxSessions: readonly string[],
  preservedEvidencePaths: readonly string[],
): void {
  console.warn(`Ticket artifact cleanup for ${options.ticketId}`);
  console.warn(`Mode: ${options.execute ? "execute" : "dry-run"}`);
  console.warn("Cleanup actions:");
  for (const action of actions) console.warn(`- ${formatAction(action)}`);
  if (actions.length === 0) console.warn("- none");
  console.warn("Reported tmux sessions:");
  for (const sessionName of reportedTmuxSessions) console.warn(`- ${sessionName}`);
  if (reportedTmuxSessions.length === 0) console.warn("- none");
  console.warn("Preserved evidence:");
  for (const path of preservedEvidencePaths) console.warn(`- ${path}`);
  if (preservedEvidencePaths.length === 0) console.warn("- none");
}

function formatAction(action: TicketArtifactCleanupAction): string {
  switch (action.kind) {
    case "remove-worktree":
      return `git worktree remove ${action.path}`;
    case "kill-tmux-session":
      return `tmux kill-session -t =${action.sessionName}`;
    case "remove-evidence":
      return `remove ${action.path}`;
  }
}

async function executeAction(action: TicketArtifactCleanupAction, repoRoot: string): Promise<void> {
  switch (action.kind) {
    case "remove-worktree":
      await runText("git", ["-C", repoRoot, "worktree", "remove", action.path]);
      return;
    case "kill-tmux-session":
      await runText("tmux", ["kill-session", "-t", `=${action.sessionName}`]);
      return;
    case "remove-evidence":
      await Bun.file(action.path).delete();
      return;
  }
}
