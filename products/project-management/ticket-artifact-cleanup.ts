import { basename, join, relative } from "node:path";
import { TICKET_WORKTREE_ROOT, TMUX_SESSION_KINDS } from "./temporal/command-activities";

export type TicketArtifactCleanupOptions = {
  readonly ticketId: string;
  readonly repoRoot: string;
  readonly runtimeLogRoot: string;
  readonly worktreePaths: readonly string[];
  readonly tmuxSessions: readonly string[];
  readonly evidenceFileNames: readonly string[];
  readonly removeEvidence?: boolean;
  readonly killTmuxSessions?: boolean;
};

export type TicketArtifactCleanupAction =
  | { readonly kind: "remove-worktree"; readonly path: string }
  | { readonly kind: "kill-tmux-session"; readonly sessionName: string }
  | { readonly kind: "remove-evidence"; readonly path: string };

export type TicketArtifactCleanupPlan = {
  readonly ticketId: string;
  readonly actions: readonly TicketArtifactCleanupAction[];
  readonly reportedTmuxSessions: readonly string[];
  readonly preservedEvidencePaths: readonly string[];
  readonly ignoredWorktreePaths: readonly string[];
  readonly ignoredTmuxSessions: readonly string[];
  readonly ignoredEvidenceFileNames: readonly string[];
};

const TICKET_ID_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export function planTicketArtifactCleanup(
  options: TicketArtifactCleanupOptions,
): TicketArtifactCleanupPlan {
  assertSafeTicketId(options.ticketId);
  const matchingWorktrees = options.worktreePaths.filter((path) =>
    isTicketWorkflowWorktree(options.repoRoot, options.ticketId, path),
  );
  const matchingTmuxSessions = options.tmuxSessions.filter((session) =>
    isTicketWorkflowTmuxSession(options.ticketId, session),
  );
  const matchingEvidenceNames = options.evidenceFileNames.filter((name) =>
    isTicketWorkflowEvidenceFile(options.ticketId, name),
  );
  const evidencePaths = matchingEvidenceNames.map((name) => join(options.runtimeLogRoot, name));

  return {
    ticketId: options.ticketId,
    actions: [
      ...matchingWorktrees.map((path) => ({ kind: "remove-worktree" as const, path })),
      ...(options.killTmuxSessions
        ? matchingTmuxSessions.map((sessionName) => ({
            kind: "kill-tmux-session" as const,
            sessionName,
          }))
        : []),
      ...(options.removeEvidence
        ? evidencePaths.map((path) => ({ kind: "remove-evidence" as const, path }))
        : []),
    ],
    reportedTmuxSessions: options.killTmuxSessions ? [] : matchingTmuxSessions,
    preservedEvidencePaths: options.removeEvidence ? [] : evidencePaths,
    ignoredWorktreePaths: options.worktreePaths.filter((path) => !matchingWorktrees.includes(path)),
    ignoredTmuxSessions: options.tmuxSessions.filter(
      (session) => !matchingTmuxSessions.includes(session),
    ),
    ignoredEvidenceFileNames: options.evidenceFileNames.filter(
      (name) => !matchingEvidenceNames.includes(name),
    ),
  };
}

export function isTicketWorkflowWorktree(
  repoRoot: string,
  ticketId: string,
  worktreePath: string,
): boolean {
  assertSafeTicketId(ticketId);
  const worktreeRoot = join(repoRoot, TICKET_WORKTREE_ROOT);
  const relativePath = relative(worktreeRoot, worktreePath);
  if (relativePath.startsWith("..") || relativePath === "") return false;
  return basename(worktreePath).startsWith(`${ticketId}-`);
}

export function isTicketWorkflowTmuxSession(ticketId: string, sessionName: string): boolean {
  assertSafeTicketId(ticketId);
  const safeTicketId = ticketId.replaceAll(".", "_");
  return TMUX_SESSION_KINDS.some((kind) =>
    new RegExp(`^ticket_${escapeRegExp(safeTicketId)}_${kind}_[1-9]\\d*$`).test(sessionName),
  );
}

export function isTicketWorkflowEvidenceFile(ticketId: string, fileName: string): boolean {
  assertSafeTicketId(ticketId);
  const safeTicketId = ticketId.replaceAll(".", "_");
  return (
    fileName.startsWith(`ticket_${ticketId}_`) || fileName.startsWith(`ticket_${safeTicketId}_`)
  );
}

function assertSafeTicketId(ticketId: string): void {
  if (!TICKET_ID_PATTERN.test(ticketId)) {
    throw new Error(`ticket id is not safe for artifact cleanup: ${ticketId}`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
