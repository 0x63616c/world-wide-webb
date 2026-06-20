export const TICKET_WORKFLOW_LABELS = {
  backlog: "ticket-backlog",
  queued: "ticket-queued",
  ready: "ticket-ready",
  review: "ticket-review",
  verified: "ticket-verified",
  retry: "ticket-retry",
  human: "ticket-human",
  shipped: "ticket-shipped",
} as const;

export const ACTIVE_TICKET_LIFECYCLE_LABELS = [
  TICKET_WORKFLOW_LABELS.ready,
  TICKET_WORKFLOW_LABELS.review,
  TICKET_WORKFLOW_LABELS.verified,
  TICKET_WORKFLOW_LABELS.retry,
  TICKET_WORKFLOW_LABELS.human,
  TICKET_WORKFLOW_LABELS.shipped,
] as const;

export type ActiveTicketLifecycleLabel = (typeof ACTIVE_TICKET_LIFECYCLE_LABELS)[number];

export const TICKET_QUEUE_LABELS = {
  builder: TICKET_WORKFLOW_LABELS.ready,
  review: TICKET_WORKFLOW_LABELS.review,
  verified: TICKET_WORKFLOW_LABELS.verified,
  human: TICKET_WORKFLOW_LABELS.human,
} as const;

export type TicketQueue = keyof typeof TICKET_QUEUE_LABELS;

export const TICKET_METADATA_KEYS = {
  phase: "ticket_phase",
  attempt: "ticket_attempt",
  attempts: "ticket_attempts",
  branch: "ticket_branch",
  worktree: "ticket_worktree",
  tmuxSession: "ticket_tmux_session",
  promptPath: "ticket_prompt_path",
  stdoutLog: "ticket_stdout_log",
  stderrLog: "ticket_stderr_log",
  openCodeSession: "ticket_opencode_session",
  commit: "ticket_commit",
  lastResult: "ticket_last_result",
} as const;

export type TicketWorkflowMetadata = {
  phase: string;
  attempt: number;
  branch: string;
  worktree: string;
  tmuxSession: string;
  promptPath: string;
  stdoutLog: string;
  stderrLog: string;
  openCodeSession: string;
  commit: string;
  lastResult: string;
};

export type BeadsCommand = {
  command: "bd";
  args: readonly string[];
  stdin?: string;
};

export type BeadsCommandRunner = (command: BeadsCommand) => Promise<string>;

export type BeadsTicket = {
  id: string;
  title: string;
  status: string;
  labels: readonly string[];
};

export type BeadsTicketComment = {
  text: string;
};

export type BeadsTicketDetails = BeadsTicket & {
  acceptanceCriteria: string;
  comments: readonly BeadsTicketComment[];
  metadata?: Readonly<Record<string, string>>;
};

export function buildQueueCommand(queue: TicketQueue): BeadsCommand {
  const args = [
    "list",
    "--json",
    "--no-pager",
    "-n",
    "0",
    "--status",
    "open",
    "--label",
    TICKET_QUEUE_LABELS[queue],
  ];

  if (queue === "builder") {
    args.push(
      "--ready",
      "--exclude-label",
      TICKET_WORKFLOW_LABELS.human,
      "--exclude-label",
      TICKET_WORKFLOW_LABELS.backlog,
    );
  }

  return { command: "bd", args };
}

export function buildRetryQueueCommand(): BeadsCommand {
  return {
    command: "bd",
    args: [
      "list",
      "--json",
      "--no-pager",
      "-n",
      "0",
      "--status",
      "open",
      "--label",
      TICKET_WORKFLOW_LABELS.retry,
      "--ready",
      "--exclude-label",
      TICKET_WORKFLOW_LABELS.human,
      "--exclude-label",
      TICKET_WORKFLOW_LABELS.backlog,
    ],
  };
}

export function activeTicketLifecycleLabels(
  labels: readonly string[],
): readonly ActiveTicketLifecycleLabel[] {
  const labelSet = new Set(labels);
  return ACTIVE_TICKET_LIFECYCLE_LABELS.filter((label) => labelSet.has(label));
}

export function assertNoConflictingTicketLifecycleLabels(labels: readonly string[]): void {
  const present = activeTicketLifecycleLabels(labels);
  if (present.length > 1) {
    throw new Error(`Conflicting ticket lifecycle labels: ${present.join(", ")}`);
  }
}

export function lifecycleTransitionLabelArgs(
  target: ActiveTicketLifecycleLabel | null,
): readonly string[] {
  return [
    ...(target ? ["--add-label", target] : []),
    ...ACTIVE_TICKET_LIFECYCLE_LABELS.flatMap((label) =>
      label === target ? [] : ["--remove-label", label],
    ),
  ];
}

export function buildMetadataCommand(
  ticketId: string,
  metadata: TicketWorkflowMetadata,
): BeadsCommand {
  return {
    command: "bd",
    args: [
      "update",
      ticketId,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.phase}=${metadata.phase}`,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.attempt}=${metadata.attempt}`,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.attempts}=${metadata.attempt}`,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.branch}=${metadata.branch}`,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.worktree}=${metadata.worktree}`,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.tmuxSession}=${metadata.tmuxSession}`,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.promptPath}=${metadata.promptPath}`,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.stdoutLog}=${metadata.stdoutLog}`,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.stderrLog}=${metadata.stderrLog}`,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.openCodeSession}=${metadata.openCodeSession}`,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.commit}=${metadata.commit}`,
      "--set-metadata",
      `${TICKET_METADATA_KEYS.lastResult}=${metadata.lastResult}`,
    ],
  };
}

export type TicketCommentKind = "builder-summary" | "reviewer-findings" | "escalation";

const COMMENT_HEADINGS = {
  "builder-summary": "Builder summary",
  "reviewer-findings": "Reviewer findings",
  escalation: "Escalation",
} as const satisfies Record<TicketCommentKind, string>;

export function buildCommentCommand(
  ticketId: string,
  kind: TicketCommentKind,
  body: string,
): BeadsCommand {
  return {
    command: "bd",
    args: ["comment", ticketId, "--stdin"],
    stdin: `## ${COMMENT_HEADINGS[kind]}\n\n${body}`,
  };
}

export function buildFailedReviewRequeueCommand(ticketId: string): BeadsCommand {
  return {
    command: "bd",
    args: ["update", ticketId, ...lifecycleTransitionLabelArgs(TICKET_WORKFLOW_LABELS.retry)],
  };
}

export function buildDownstreamBlockedProbeCommand(downstreamTicketId: string): BeadsCommand {
  return {
    command: "bd",
    args: ["list", "--ready", "--json", "--no-pager", "-n", "0", "--id", downstreamTicketId],
  };
}

export function buildShowTicketsCommand(ticketIds: readonly string[]): BeadsCommand {
  return {
    command: "bd",
    args: ["show", ...ticketIds, "--json", "--include-comments"],
  };
}

export function isDownstreamBlockedProbeResult(stdout: string): boolean {
  return parseTickets(stdout).length === 0;
}

export class BeadsAdapter {
  readonly #run: BeadsCommandRunner;

  constructor(run: BeadsCommandRunner) {
    this.#run = run;
  }

  async builderQueue(): Promise<BeadsTicket[]> {
    const ready = await this.readQueue("builder");
    const retry = parseTickets(await this.#run(buildRetryQueueCommand()));
    return uniqueTicketsById([...ready, ...retry]);
  }

  async reviewQueue(): Promise<BeadsTicket[]> {
    return this.readQueue("review");
  }

  async verifiedQueue(): Promise<BeadsTicket[]> {
    return this.readQueue("verified");
  }

  async humanQueue(): Promise<BeadsTicket[]> {
    return this.readQueue("human");
  }

  async showTickets(ticketIds: readonly string[]): Promise<BeadsTicketDetails[]> {
    if (ticketIds.length === 0) return [];
    const stdout = await this.#run(buildShowTicketsCommand(ticketIds));
    return parseTicketDetails(stdout);
  }

  async writeMetadata(ticketId: string, metadata: TicketWorkflowMetadata): Promise<void> {
    await this.#run(buildMetadataCommand(ticketId, metadata));
  }

  async writeBuilderSummary(ticketId: string, body: string): Promise<void> {
    await this.#run(buildCommentCommand(ticketId, "builder-summary", body));
  }

  async writeReviewerFindings(ticketId: string, body: string): Promise<void> {
    await this.#run(buildCommentCommand(ticketId, "reviewer-findings", body));
  }

  async requeueFailedReview(ticketId: string): Promise<void> {
    await this.#run(buildFailedReviewRequeueCommand(ticketId));
  }

  async writeEscalation(ticketId: string, body: string): Promise<void> {
    await this.#run(buildCommentCommand(ticketId, "escalation", body));
  }

  async downstreamDependencyBlocked(downstreamTicketId: string): Promise<boolean> {
    const stdout = await this.#run(buildDownstreamBlockedProbeCommand(downstreamTicketId));
    return isDownstreamBlockedProbeResult(stdout);
  }

  private async readQueue(queue: TicketQueue): Promise<BeadsTicket[]> {
    const stdout = await this.#run(buildQueueCommand(queue));
    return parseTickets(stdout);
  }
}

function uniqueTicketsById(tickets: readonly BeadsTicket[]): BeadsTicket[] {
  const seen = new Set<string>();
  return tickets.filter((ticket) => {
    if (seen.has(ticket.id)) return false;
    seen.add(ticket.id);
    return true;
  });
}

function parseTickets(stdout: string): BeadsTicket[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((ticket) => (isBeadsTicket(ticket) ? [ticket] : []));
}

function parseTicketDetails(stdout: string): BeadsTicketDetails[] {
  const parsed: unknown = JSON.parse(stdout);
  const tickets = Array.isArray(parsed) ? parsed : [parsed];
  return tickets.flatMap(parseTicketDetail);
}

function isBeadsTicket(value: unknown): value is BeadsTicket {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.status === "string" &&
    Array.isArray(candidate.labels) &&
    candidate.labels.every((label) => typeof label === "string")
  );
}

function parseTicketDetail(value: unknown): BeadsTicketDetails[] {
  if (!isBeadsTicket(value)) return [];
  const candidate = value as Record<string, unknown>;
  const comments = Array.isArray(candidate.comments) ? candidate.comments : [];
  const metadata = parseMetadata(candidate.metadata);
  return [
    {
      id: value.id,
      title: value.title,
      status: value.status,
      labels: value.labels,
      acceptanceCriteria: stringField(candidate, "acceptance_criteria"),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      comments: comments.flatMap((comment) => {
        if (!comment || typeof comment !== "object") return [];
        const record = comment as Record<string, unknown>;
        const text =
          stringField(record, "text") ||
          stringField(record, "body") ||
          stringField(record, "content");
        return text ? [{ text }] : [];
      }),
    } satisfies BeadsTicketDetails,
  ];
}

function parseMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      typeof entry === "string" ? [[key, entry]] : [],
    ),
  );
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}
