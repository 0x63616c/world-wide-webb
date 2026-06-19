import { TICKET_METADATA_KEYS, TICKET_WORKFLOW_LABELS } from "./beads-adapter";
import type { DesignIssue } from "./map";

const WORKFLOW_COLUMNS = [
  { id: "ready", title: "Ready" },
  { id: "in_progress", title: "In Progress" },
  { id: "blocked", title: "Blocked" },
  { id: "closed", title: "Closed" },
] as const satisfies readonly { id: DesignIssue["status"]; title: string }[];

export type WorkflowColumn = (typeof WORKFLOW_COLUMNS)[number] & {
  issueIds: string[];
};

export function workflowColumnsForIssues(
  issues: readonly Pick<DesignIssue, "id" | "status">[],
): WorkflowColumn[] {
  return WORKFLOW_COLUMNS.map((column) => ({
    ...column,
    issueIds: issues.filter((issue) => issue.status === column.id).map((issue) => issue.id),
  }));
}

export const WORKFLOW_DASHBOARD_QUEUES = [
  { id: "ready", label: TICKET_WORKFLOW_LABELS.ready, title: "Builder" },
  { id: "review", label: TICKET_WORKFLOW_LABELS.review, title: "Review" },
  { id: "verified", label: TICKET_WORKFLOW_LABELS.verified, title: "Verified" },
  { id: "retry", label: TICKET_WORKFLOW_LABELS.retry, title: "Retry" },
  { id: "human", label: TICKET_WORKFLOW_LABELS.human, title: "Human" },
] as const;

export type WorkflowDashboardQueueId = (typeof WORKFLOW_DASHBOARD_QUEUES)[number]["id"];

export type WorkflowDashboardRunRole = "builder" | "reviewer" | "merge";

export type WorkflowDashboardIssueInput = Pick<
  DesignIssue,
  "id" | "title" | "labels" | "status" | "assignee"
> & {
  readonly metadata?: Record<string, unknown>;
  readonly comments?: DesignIssue["comments"];
};

export type WorkflowDashboardIssue = {
  readonly id: string;
  readonly title: string;
  readonly queue: WorkflowDashboardQueueId;
  readonly queueLabel: string;
  readonly phase: string;
  readonly activeRun: WorkflowDashboardRunRole | null;
  readonly assignee: string;
  readonly attempts: number | null;
  readonly tmuxSession: string | null;
  readonly tmuxAttachCommand: string | null;
  readonly openCodeSessionId: string | null;
  readonly openCodeSessionTitle: string | null;
  readonly logLinks: readonly string[];
  readonly promptLinks: readonly string[];
  readonly lastResult: string | null;
};

export type WorkflowDashboardColumn = (typeof WORKFLOW_DASHBOARD_QUEUES)[number] & {
  readonly tickets: readonly WorkflowDashboardIssue[];
};

export type WorkflowDashboard = {
  readonly columns: readonly WorkflowDashboardColumn[];
  readonly activeRuns: readonly WorkflowDashboardIssue[];
};

export function workflowDashboardForIssues(
  issues: readonly WorkflowDashboardIssueInput[],
): WorkflowDashboard {
  const tickets = issues.flatMap((issue) => {
    const queue = queueForIssue(issue);
    if (!queue) return [];
    return [workflowDashboardIssue(issue, queue)];
  });

  return {
    columns: WORKFLOW_DASHBOARD_QUEUES.map((queue) => ({
      ...queue,
      tickets: tickets.filter((ticket) => ticket.queue === queue.id),
    })),
    activeRuns: tickets.filter((ticket) => ticket.activeRun !== null),
  };
}

function workflowDashboardIssue(
  issue: WorkflowDashboardIssueInput,
  queue: (typeof WORKFLOW_DASHBOARD_QUEUES)[number],
): WorkflowDashboardIssue {
  const metadata = issue.metadata ?? {};
  const metadataPhase = stringMeta(metadata, TICKET_METADATA_KEYS.phase);
  const phase = metadataPhase ?? phaseFromQueue(queue.id);
  const tmuxSession = stringMeta(metadata, TICKET_METADATA_KEYS.tmuxSession);
  const openCode = parseOpenCodeSession(
    stringMeta(metadata, TICKET_METADATA_KEYS.openCodeSession),
    stringMeta(metadata, "ticket_opencode_session_title"),
  );
  const text = commentsText(issue.comments);

  return {
    id: issue.id,
    title: issue.title,
    queue: queue.id,
    queueLabel: queue.label,
    phase,
    activeRun: activeRunForPhase(metadataPhase),
    assignee: issue.assignee,
    attempts:
      numberMeta(metadata, TICKET_METADATA_KEYS.attempt) ??
      numberMeta(metadata, TICKET_METADATA_KEYS.attempts),
    tmuxSession,
    tmuxAttachCommand: tmuxSession ? `tmux attach -t ${tmuxSession}` : null,
    openCodeSessionId: openCode.id,
    openCodeSessionTitle: openCode.title,
    logLinks: uniqueLinks([
      ...linksFromMetadata(metadata, [
        "ticket_log",
        "ticket_log_path",
        "ticket_stdout_log",
        "ticket_stderr_log",
      ]),
      ...linksMatching(text, /\S+\.log\b/g),
    ]),
    promptLinks: uniqueLinks([
      ...linksFromMetadata(metadata, ["ticket_prompt", "ticket_prompt_path"]),
      ...linksMatching(text, /\S+\.prompt\.md\b/g),
    ]),
    lastResult: stringMeta(metadata, TICKET_METADATA_KEYS.lastResult),
  };
}

function queueForIssue(
  issue: Pick<WorkflowDashboardIssueInput, "labels" | "status">,
): (typeof WORKFLOW_DASHBOARD_QUEUES)[number] | null {
  if (issue.status === "closed") return null;
  const labels = new Set(issue.labels);
  if (labels.has(TICKET_WORKFLOW_LABELS.human)) return WORKFLOW_DASHBOARD_QUEUES[4];
  if (labels.has(TICKET_WORKFLOW_LABELS.retry)) return WORKFLOW_DASHBOARD_QUEUES[3];
  if (labels.has(TICKET_WORKFLOW_LABELS.verified)) return WORKFLOW_DASHBOARD_QUEUES[2];
  if (labels.has(TICKET_WORKFLOW_LABELS.review)) return WORKFLOW_DASHBOARD_QUEUES[1];
  if (labels.has(TICKET_WORKFLOW_LABELS.ready)) return WORKFLOW_DASHBOARD_QUEUES[0];
  return null;
}

function phaseFromQueue(queue: WorkflowDashboardQueueId): string {
  switch (queue) {
    case "ready":
      return "ready";
    case "review":
      return "review";
    case "verified":
      return "verified";
    case "retry":
      return "build";
    case "human":
      return "human";
  }
}

function activeRunForPhase(phase: string | null): WorkflowDashboardRunRole | null {
  switch (phase) {
    case "build":
      return "builder";
    case "review":
      return "reviewer";
    case "merge":
      return "merge";
    default:
      return null;
  }
}

function stringMeta(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function numberMeta(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOpenCodeSession(
  raw: string | null,
  title: string | null,
): { readonly id: string | null; readonly title: string | null } {
  if (!raw) return { id: null, title };
  const match = raw.match(/^(?<title>.+?)\s*\((?<id>[^)]+)\)$/);
  if (match?.groups) {
    return { id: match.groups.id, title: title ?? match.groups.title };
  }
  return { id: raw, title };
}

function commentsText(comments: WorkflowDashboardIssueInput["comments"]): string {
  return (comments ?? []).map((comment) => comment.text).join("\n");
}

function linksFromMetadata(metadata: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.flatMap((key) => {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return [value.trim()];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
    return [];
  });
}

function linksMatching(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[0]);
}

function uniqueLinks(links: readonly string[]): string[] {
  return [...new Set(links.map((link) => link.trim()).filter(Boolean))];
}
