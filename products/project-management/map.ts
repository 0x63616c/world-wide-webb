// Pure mapper: raw `bd list --all --json` issues -> shape the design mockup consumes.

export interface RawIssue {
  id: string;
  title: string;
  description?: string;
  acceptance_criteria?: string;
  notes?: string;
  status: string;
  priority: number;
  issue_type: string;
  owner?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  labels?: string[];
  metadata?: Record<string, unknown>;
  comments?: RawIssueComment[];
  dependencies?: { issue_id: string; depends_on_id: string; type: string }[];
}

export interface RawIssueComment {
  id?: string;
  author?: string;
  body?: string;
  text?: string;
  content?: string;
  created_at?: string;
}

export interface DesignIssueComment {
  id: string;
  author: string;
  text: string;
  created: number;
}

export interface DesignIssue {
  id: string;
  type: "feature" | "bug" | "task" | "epic" | "message";
  title: string;
  status: "ready" | "in_progress" | "blocked" | "closed";
  p: number;
  assignee: string;
  labels: string[];
  metadata?: Record<string, unknown>;
  comments: DesignIssueComment[];
  blockedBy: string[];
  blocks: string[];
  desc: string;
  acceptance: string; // acceptance_criteria; "" if none
  notes: string; // free-form notes; "" if none
  children?: string[];
  ts: number; // updated_at (fallback created_at) as epoch ms; 0 if unknown. For sorting.
  created: number; // created_at as epoch ms; 0 if unknown
  updated: number; // updated_at as epoch ms; 0 if unknown
  createdBy: string; // short handle of the creator
}

// bd issue_type -> mockup type. Anything unrecognized falls back to 'task'.
function mapType(issueType: string): DesignIssue["type"] {
  switch (issueType) {
    case "feature":
      return "feature";
    case "bug":
      return "bug";
    case "epic":
    case "milestone":
      return "epic";
    case "task":
    case "chore":
    case "decision":
    case "spike":
    case "story":
      return "task";
    default:
      return "task";
  }
}

// bd status -> mockup status. Unknown -> 'ready'.
function mapStatus(status: string): DesignIssue["status"] {
  switch (status) {
    case "open":
    case "pinned":
      return "ready";
    case "in_progress":
    case "hooked":
      return "in_progress";
    case "blocked":
    case "deferred":
      return "blocked";
    case "closed":
      return "closed";
    default:
      return "ready";
  }
}

// owner/created_by email -> short handle. "6991398+0x63616c@u..." -> "0x63616c".
function mapAssignee(owner?: string, createdBy?: string): string {
  const raw = (owner ?? createdBy ?? "").trim();
  if (!raw) return "";
  if (!raw.includes("@")) return raw;
  const local = raw.slice(0, raw.indexOf("@"));
  if (local.includes("+")) return local.slice(local.indexOf("+") + 1).trim();
  return local.trim();
}

// ISO timestamp -> epoch ms; 0 when missing/unparseable (sorts oldest).
function parseTs(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

function getOrCreateArray(map: Map<string, string[]>, key: string): string[] {
  const existing = map.get(key);
  if (existing) return existing;
  const created: string[] = [];
  map.set(key, created);
  return created;
}

export function mapIssues(raw: RawIssue[]): DesignIssue[] {
  const known = new Set(raw.map((r) => r.id));

  // Flatten every dependency row once. A row lives ON issue_id.
  type Dep = { issue_id: string; depends_on_id: string; type: string };
  const allDeps: Dep[] = [];
  for (const issue of raw) {
    for (const dep of issue.dependencies ?? []) allDeps.push(dep);
  }

  // Pre-index, dropping any edge whose endpoints aren't in the list.
  const blockedByMap = new Map<string, string[]>(); // X -> ids that block X
  const blocksMap = new Map<string, string[]>(); // X -> ids X blocks
  const childrenMap = new Map<string, string[]>(); // parent -> child ids

  for (const dep of allDeps) {
    if (!known.has(dep.issue_id) || !known.has(dep.depends_on_id)) continue;
    if (dep.type === "blocks") {
      // issue_id is blocked by depends_on_id.
      getOrCreateArray(blockedByMap, dep.issue_id).push(dep.depends_on_id);
      getOrCreateArray(blocksMap, dep.depends_on_id).push(dep.issue_id);
    } else if (dep.type === "parent-child") {
      // issue_id is the child, depends_on_id is the parent.
      getOrCreateArray(childrenMap, dep.depends_on_id).push(dep.issue_id);
    }
  }

  return raw.map((issue) => {
    const type = mapType(issue.issue_type);
    const out: DesignIssue = {
      id: issue.id,
      type,
      title: issue.title,
      status: mapStatus(issue.status),
      p: Math.min(Math.max(issue.priority ?? 2, 0), 4),
      assignee: mapAssignee(issue.owner, issue.created_by),
      labels: issue.labels ?? [],
      metadata: issue.metadata,
      comments: mapComments(issue.comments),
      blockedBy: blockedByMap.get(issue.id) ?? [],
      blocks: blocksMap.get(issue.id) ?? [],
      desc: issue.description ?? "",
      acceptance: issue.acceptance_criteria ?? "",
      notes: issue.notes ?? "",
      ts: parseTs(issue.updated_at ?? issue.created_at),
      created: parseTs(issue.created_at),
      updated: parseTs(issue.updated_at),
      createdBy: mapAssignee(issue.created_by),
    };
    if (type === "epic") out.children = childrenMap.get(issue.id) ?? [];
    return out;
  });
}

function mapComments(comments: RawIssueComment[] | undefined): DesignIssueComment[] {
  return (comments ?? []).flatMap((comment, index) => {
    const text = (comment.text ?? comment.body ?? comment.content ?? "").trim();
    if (!text) return [];
    return [
      {
        id: comment.id ?? `comment_${index}`,
        author: mapAssignee(comment.author),
        text,
        created: parseTs(comment.created_at),
      },
    ];
  });
}
