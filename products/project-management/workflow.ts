import {
  assertNoConflictingTicketLifecycleLabels,
  TICKET_METADATA_KEYS,
  TICKET_WORKFLOW_LABELS,
} from "./beads-adapter";
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
  { id: "backlog", label: TICKET_WORKFLOW_LABELS.backlog, title: "Backlog" },
  { id: "queued", label: TICKET_WORKFLOW_LABELS.queued, title: "Queued" },
  { id: "ready", label: TICKET_WORKFLOW_LABELS.ready, title: "Builder" },
  { id: "review", label: TICKET_WORKFLOW_LABELS.review, title: "Review" },
  { id: "verified", label: TICKET_WORKFLOW_LABELS.verified, title: "Merge Queue" },
  { id: "human", label: TICKET_WORKFLOW_LABELS.human, title: "Human" },
  { id: "shipped", label: TICKET_WORKFLOW_LABELS.shipped, title: "Shipped" },
] as const;

export type WorkflowDashboardQueueId = (typeof WORKFLOW_DASHBOARD_QUEUES)[number]["id"];

export type WorkflowDashboardRunRole = "builder" | "reviewer" | "merge";

export type WorkflowDashboardIssueInput = Pick<
  DesignIssue,
  "id" | "title" | "labels" | "status" | "assignee"
> & {
  readonly blockedBy?: DesignIssue["blockedBy"];
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
  readonly temporalLink: WorkflowDashboardTemporalLink | null;
  readonly lastResult: string | null;
  readonly exhaustion: WorkflowDashboardExhaustion | null;
};

export type WorkflowDashboardTemporalLink = {
  readonly workflowId: string;
  readonly runId: string | null;
  readonly href: string;
};

export type WorkflowDashboardArtifactTexts = Readonly<Record<string, string>>;

export type WorkflowDashboardExhaustion = {
  readonly stopReason: string;
  readonly builderLimitHit: boolean;
  readonly reviewerLimitHit: boolean;
  readonly builderFailure: WorkflowDashboardBuilderFailure | null;
  readonly reviewerFailure: WorkflowDashboardReviewerFailure | null;
};

export type WorkflowDashboardBuilderFailure = {
  readonly ticketId: string;
  readonly ticketTitle: string;
  readonly attempt: number | null;
  readonly phase: string;
  readonly commandName: string;
  readonly exitStatus: number | null;
  readonly excerpt: string;
  readonly artifactLink: string | null;
};

export type WorkflowDashboardReviewerFailure = {
  readonly role: string;
  readonly findingSummary: string;
  readonly fileLineReferences: readonly string[];
  readonly blockingCriterionOrGate: string;
  readonly artifactLink: string | null;
};

export type WorkflowDashboardColumn = (typeof WORKFLOW_DASHBOARD_QUEUES)[number] & {
  readonly tickets: readonly WorkflowDashboardIssue[];
};

export type WorkflowDashboardColumnFilter = "all" | readonly WorkflowDashboardQueueId[];

export type WorkflowDashboard = {
  readonly columns: readonly WorkflowDashboardColumn[];
  readonly activeRuns: readonly WorkflowDashboardIssue[];
};

export function workflowDashboardForIssues(
  issues: readonly WorkflowDashboardIssueInput[],
  artifactTexts: WorkflowDashboardArtifactTexts = {},
): WorkflowDashboard {
  const tickets = issues.flatMap((issue) => {
    const queue = queueForIssue(issue);
    if (!queue) return [];
    return [workflowDashboardIssue(issue, queue, artifactTexts)];
  });

  return {
    columns: WORKFLOW_DASHBOARD_QUEUES.map((queue) => ({
      ...queue,
      tickets: tickets.filter((ticket) => ticket.queue === queue.id),
    })),
    activeRuns: tickets.filter((ticket) => ticket.activeRun !== null),
  };
}

export function workflowDashboardColumnsForFilter(
  dashboard: WorkflowDashboard,
  selectedColumns: WorkflowDashboardColumnFilter,
): readonly WorkflowDashboardColumn[] {
  if (selectedColumns === "all" || selectedColumns.length === 0) return dashboard.columns;
  const selected = new Set(selectedColumns);
  return dashboard.columns.filter((column) => selected.has(column.id));
}

function workflowDashboardIssue(
  issue: WorkflowDashboardIssueInput,
  queue: (typeof WORKFLOW_DASHBOARD_QUEUES)[number],
  artifactTexts: WorkflowDashboardArtifactTexts,
): WorkflowDashboardIssue {
  const metadata = issue.metadata ?? {};
  const metadataPhase = stringMeta(metadata, TICKET_METADATA_KEYS.phase);
  const phase =
    queue.id === "shipped" ? "shipped" : (metadataPhase ?? fallbackPhaseForIssue(issue, queue.id));
  const tmuxSession = stringMeta(metadata, TICKET_METADATA_KEYS.tmuxSession);
  const openCode = parseOpenCodeSession(
    stringMeta(metadata, TICKET_METADATA_KEYS.openCodeSession),
    stringMeta(metadata, "ticket_opencode_session_title"),
  );
  const text = commentsText(issue.comments);

  const attempts = numberMeta(metadata, TICKET_METADATA_KEYS.attempts);
  const lastResult = stringMeta(metadata, TICKET_METADATA_KEYS.lastResult);
  const logLinks = uniqueLinks([
    ...linksFromMetadata(metadata, [
      "ticket_log",
      "ticket_log_path",
      "ticket_stdout_log",
      "ticket_stderr_log",
    ]),
    ...linksMatching(text, /\S+\.log\b/g),
  ]);
  const promptLinks = uniqueLinks([
    ...linksFromMetadata(metadata, ["ticket_prompt", "ticket_prompt_path"]),
    ...linksMatching(text, /\S+\.prompt\.md\b/g),
  ]);
  const temporalLink = temporalLinkForIssue(issue, metadata);

  return {
    id: issue.id,
    title: issue.title,
    queue: queue.id,
    queueLabel: queue.label,
    phase,
    activeRun: activeRunForPhase(queue.id, phase),
    assignee: issue.assignee,
    attempts,
    tmuxSession,
    tmuxAttachCommand: tmuxSession ? `tmux attach -t ${tmuxSession}` : null,
    openCodeSessionId: openCode.id,
    openCodeSessionTitle: openCode.title,
    logLinks,
    promptLinks,
    temporalLink,
    lastResult,
    exhaustion: exhaustionForIssue({
      issue,
      queueId: queue.id,
      phase,
      attempts,
      lastResult,
      logLinks,
      artifactTexts,
    }),
  };
}

function temporalLinkForIssue(
  issue: Pick<WorkflowDashboardIssueInput, "id">,
  metadata: Record<string, unknown>,
): WorkflowDashboardTemporalLink | null {
  const explicitHref = stringMeta(metadata, "ticket_temporal_url");
  if (explicitHref) {
    return {
      workflowId: stringMeta(metadata, "ticket_temporal_workflow_id") ?? `ticket_${issue.id}`,
      runId: stringMeta(metadata, "ticket_temporal_run_id"),
      href: explicitHref,
    };
  }

  if (!hasTicketWorkflowMetadata(metadata)) return null;

  const workflowId =
    stringMeta(metadata, "ticket_temporal_workflow_id") ??
    stringMeta(metadata, "ticket_workflow_id") ??
    `ticket_${issue.id}`;
  const runId =
    stringMeta(metadata, "ticket_temporal_run_id") ??
    stringMeta(metadata, "ticket_workflow_run_id");
  return {
    workflowId,
    runId,
    href: temporalWorkflowHref("project-management", workflowId, runId),
  };
}

function hasTicketWorkflowMetadata(metadata: Record<string, unknown>): boolean {
  return [
    TICKET_METADATA_KEYS.phase,
    TICKET_METADATA_KEYS.attempts,
    TICKET_METADATA_KEYS.tmuxSession,
    TICKET_METADATA_KEYS.openCodeSession,
    TICKET_METADATA_KEYS.lastResult,
    TICKET_METADATA_KEYS.branch,
    TICKET_METADATA_KEYS.worktree,
    TICKET_METADATA_KEYS.promptPath,
    TICKET_METADATA_KEYS.stdoutLog,
    TICKET_METADATA_KEYS.stderrLog,
    "ticket_temporal_workflow_id",
    "ticket_workflow_id",
    "ticket_temporal_run_id",
    "ticket_workflow_run_id",
  ].some((key) => stringMeta(metadata, key) !== null || numberMeta(metadata, key) !== null);
}

function temporalWorkflowHref(namespace: string, workflowId: string, runId: string | null): string {
  const encodedNamespace = encodeURIComponent(namespace);
  const encodedWorkflowId = encodeURIComponent(workflowId);
  if (!runId)
    return `http://127.0.0.1:8233/namespaces/${encodedNamespace}/workflows/${encodedWorkflowId}`;
  return `http://127.0.0.1:8233/namespaces/${encodedNamespace}/workflows/${encodedWorkflowId}/${encodeURIComponent(runId)}/history`;
}

function exhaustionForIssue(input: {
  readonly issue: WorkflowDashboardIssueInput;
  readonly queueId: WorkflowDashboardQueueId;
  readonly phase: string;
  readonly attempts: number | null;
  readonly lastResult: string | null;
  readonly logLinks: readonly string[];
  readonly artifactTexts: WorkflowDashboardArtifactTexts;
}): WorkflowDashboardExhaustion | null {
  if (input.queueId !== "human") return null;
  const comments = commentsText(input.issue.comments);
  const builderLimitHit = isBuilderLimit(input.lastResult, comments);
  const reviewerLimitHit = isReviewerLimit(input.lastResult, comments);
  if (!builderLimitHit && !reviewerLimitHit) return null;

  return {
    stopReason: stopReasonText(builderLimitHit, reviewerLimitHit),
    builderLimitHit,
    reviewerLimitHit,
    builderFailure: builderLimitHit
      ? builderFailureForIssue(
          input.issue,
          input.phase,
          input.attempts,
          input.logLinks,
          input.artifactTexts,
        )
      : null,
    reviewerFailure: reviewerLimitHit
      ? reviewerFailureForIssue(comments, input.logLinks, input.artifactTexts)
      : null,
  };
}

function isBuilderLimit(lastResult: string | null, comments: string): boolean {
  if (lastResult?.startsWith("builder-")) return true;
  return /builder (attempt|limit)|builder-step-exhausted/i.test(comments);
}

function isReviewerLimit(lastResult: string | null, comments: string): boolean {
  if (lastResult?.startsWith("reviewer-")) return true;
  return /reviewer (attempt|limit)|reviewer-step-exhausted/i.test(comments);
}

function stopReasonText(builderLimitHit: boolean, reviewerLimitHit: boolean): string {
  if (builderLimitHit && reviewerLimitHit)
    return "Stopped: builder and reviewer attempt limits hit.";
  if (builderLimitHit) return "Stopped: builder attempt limit hit.";
  return "Stopped: reviewer attempt limit hit.";
}

function builderFailureForIssue(
  issue: WorkflowDashboardIssueInput,
  phase: string,
  attempt: number | null,
  logLinks: readonly string[],
  artifactTexts: WorkflowDashboardArtifactTexts,
): WorkflowDashboardBuilderFailure {
  const artifactLink = preferredLogLink(logLinks, "stderr") ?? preferredLogLink(logLinks, "stdout");
  const excerpt = conciseExcerpt(artifactLink ? artifactTexts[artifactLink] : null);
  const exitStatus = exitStatusForArtifact(artifactLink, artifactTexts);
  return {
    ticketId: issue.id,
    ticketTitle: issue.title,
    attempt,
    phase,
    commandName: "ticket-builder",
    exitStatus,
    excerpt,
    artifactLink,
  };
}

function reviewerFailureForIssue(
  comments: string,
  logLinks: readonly string[],
  artifactTexts: WorkflowDashboardArtifactTexts,
): WorkflowDashboardReviewerFailure {
  const artifactLink = preferredLogLink(logLinks, "stderr") ?? preferredLogLink(logLinks, "stdout");
  const logExcerpt = conciseExcerpt(artifactLink ? artifactTexts[artifactLink] : null);
  const findingText = reviewerFindingsText(comments) || logExcerpt;
  return {
    role: "ticket-reviewer",
    findingSummary:
      firstContentLine(findingText) || "Reviewer attempt failed without a structured finding.",
    fileLineReferences: uniqueLinks(
      linksMatching(
        findingText,
        /\S+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|css|html):\d+(?::\d+)?/g,
      ),
    ),
    blockingCriterionOrGate:
      firstMatchingLine(findingText, /acceptance|criterion|gate|blocking|must|failed/i) ||
      "Blocking acceptance criterion or gate was not identified.",
    artifactLink,
  };
}

function preferredLogLink(logLinks: readonly string[], kind: "stderr" | "stdout"): string | null {
  return logLinks.find((link) => link.includes(`.${kind}.log`)) ?? null;
}

function exitStatusForArtifact(
  artifactLink: string | null,
  artifactTexts: WorkflowDashboardArtifactTexts,
): number | null {
  if (!artifactLink) return null;
  const exitCodePath = artifactLink.replace(/\.(?:stdout|stderr)\.log$/, ".exitcode");
  const raw = artifactTexts[exitCodePath]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function conciseExcerpt(text: string | null | undefined): string {
  const lines = (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "No stderr/log excerpt available.";
  return lines.slice(-8).join("\n").slice(0, 1200);
}

function reviewerFindingsText(comments: string): string {
  const marker = /##\s+Reviewer findings/i.exec(comments);
  if (!marker) return comments;
  const after = comments.slice(marker.index + marker[0].length);
  const nextHeading = /\n##\s+/.exec(after);
  return (nextHeading ? after.slice(0, nextHeading.index) : after).trim();
}

function firstContentLine(text: string): string | null {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*]\s+/, "").trim())
      .find((line) => line && !line.startsWith("#")) ?? null
  );
}

function firstMatchingLine(text: string, pattern: RegExp): string | null {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*]\s+/, "").trim())
      .find((line) => pattern.test(line)) ?? null
  );
}

function queueForIssue(
  issue: Pick<WorkflowDashboardIssueInput, "labels" | "status" | "blockedBy" | "metadata">,
): (typeof WORKFLOW_DASHBOARD_QUEUES)[number] | null {
  const labels = new Set(issue.labels);
  const metadata = issue.metadata ?? {};
  const phase = stringMeta(metadata, TICKET_METADATA_KEYS.phase);
  const lastResult = stringMeta(metadata, TICKET_METADATA_KEYS.lastResult);
  const hasWorkflowLabel = Object.values(TICKET_WORKFLOW_LABELS).some((label) => labels.has(label));
  const hasBacklogState = labels.has(TICKET_WORKFLOW_LABELS.backlog) || phase === "backlog";
  const hasQueuedState = labels.has(TICKET_WORKFLOW_LABELS.queued) || phase === "queued";
  const hasBuilderRunState =
    phase === "build" ||
    stringMeta(metadata, TICKET_METADATA_KEYS.tmuxSession) !== null ||
    stringMeta(metadata, TICKET_METADATA_KEYS.openCodeSession) !== null;

  if (issue.status === "closed") {
    return phase === "closed" ||
      phase === "shipped" ||
      lastResult === "merge-passed" ||
      lastResult === "shipped"
      ? workflowQueue("shipped")
      : null;
  }

  assertNoConflictingTicketLifecycleLabels(issue.labels);

  if (!hasWorkflowLabel && !hasBacklogState && !hasQueuedState) return null;
  if (hasBacklogState) return workflowQueue("backlog");
  if (labels.has(TICKET_WORKFLOW_LABELS.human)) return workflowQueue("human");
  if (issue.status === "blocked" || (issue.blockedBy?.length ?? 0) > 0) {
    return workflowQueue("queued");
  }
  if (hasQueuedState) return workflowQueue("queued");
  if (labels.has(TICKET_WORKFLOW_LABELS.retry)) return workflowQueue("ready");
  if (labels.has(TICKET_WORKFLOW_LABELS.verified)) return workflowQueue("verified");
  if (labels.has(TICKET_WORKFLOW_LABELS.review)) return workflowQueue("review");
  if (labels.has(TICKET_WORKFLOW_LABELS.ready)) {
    return hasBuilderRunState ? workflowQueue("ready") : workflowQueue("queued");
  }
  return null;
}

function workflowQueue(id: WorkflowDashboardQueueId): (typeof WORKFLOW_DASHBOARD_QUEUES)[number] {
  const queue = WORKFLOW_DASHBOARD_QUEUES.find((candidate) => candidate.id === id);
  if (!queue) throw new Error(`Unknown workflow queue: ${id}`);
  return queue;
}

function phaseFromQueue(queue: WorkflowDashboardQueueId): string {
  switch (queue) {
    case "backlog":
      return "backlog";
    case "queued":
      return "queued";
    case "ready":
      return "ready";
    case "review":
      return "review";
    case "verified":
      return "verified";
    case "human":
      return "human";
    case "shipped":
      return "closed";
  }
}

function fallbackPhaseForIssue(
  issue: Pick<WorkflowDashboardIssueInput, "labels">,
  queue: WorkflowDashboardQueueId,
): string {
  return issue.labels.includes(TICKET_WORKFLOW_LABELS.retry) ? "build" : phaseFromQueue(queue);
}

function activeRunForPhase(
  queue: WorkflowDashboardQueueId,
  phase: string | null,
): WorkflowDashboardRunRole | null {
  if (queue === "ready" && phase === "build") return "builder";
  if (queue === "review" && phase === "review") return "reviewer";
  return null;
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
