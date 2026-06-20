import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    runId: text("run_id"),
    phase: text("phase").notNull(),
    status: text("status").notNull(),
    builderAttempts: integer("builder_attempts").notNull().default(0),
    reviewerAttempts: integer("reviewer_attempts").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => [
    uniqueIndex("workflow_runs_workflow_id_idx").on(table.workflowId),
    index("workflow_runs_ticket_id_idx").on(table.ticketId),
    index("workflow_runs_status_idx").on(table.status),
  ],
);

export const workflowEvents = pgTable(
  "workflow_events",
  {
    id: text("id").primaryKey(),
    workflowRunId: text("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    ticketId: text("ticket_id").notNull(),
    type: text("type").notNull(),
    phase: text("phase"),
    role: text("role"),
    outcome: text("outcome"),
    message: text("message"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => [
    index("workflow_events_workflow_run_id_idx").on(table.workflowRunId),
    index("workflow_events_ticket_id_idx").on(table.ticketId),
    index("workflow_events_occurred_at_idx").on(table.occurredAt),
  ],
);

export const workflowArtifacts = pgTable(
  "workflow_artifacts",
  {
    id: text("id").primaryKey(),
    workflowRunId: text("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    ticketId: text("ticket_id").notNull(),
    kind: text("kind").notNull(),
    path: text("path").notNull(),
    bytes: integer("bytes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => [
    uniqueIndex("workflow_artifacts_path_idx").on(table.path),
    index("workflow_artifacts_workflow_run_id_idx").on(table.workflowRunId),
    index("workflow_artifacts_ticket_id_idx").on(table.ticketId),
  ],
);

export const workflowOpenCodeUsage = pgTable(
  "workflow_opencode_usage",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id").notNull(),
    role: text("role").notNull(),
    attempt: integer("attempt"),
    opencodeSessionId: text("opencode_session_id").notNull(),
    title: text("title"),
    agent: text("agent"),
    model: text("model"),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    tokensInput: integer("tokens_input").notNull().default(0),
    tokensOutput: integer("tokens_output").notNull().default(0),
    tokensReasoning: integer("tokens_reasoning").notNull().default(0),
    tokensCacheRead: integer("tokens_cache_read").notNull().default(0),
    tokensCacheWrite: integer("tokens_cache_write").notNull().default(0),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_opencode_usage_session_idx").on(table.opencodeSessionId),
    index("workflow_opencode_usage_ticket_id_idx").on(table.ticketId),
  ],
);

export const schema = {
  workflowRuns,
  workflowEvents,
  workflowArtifacts,
  workflowOpenCodeUsage,
};
