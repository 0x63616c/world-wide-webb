// Pure mapper: raw `bd list --all --json` issues -> shape the design mockup consumes.
// No deps. Runs under Bun. See self-check at the bottom (`bun map.ts`).

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
  assignee?: string;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  closed_at?: string;
  labels?: string[];
  dependencies?: { issue_id: string; depends_on_id: string; type: string }[];
  comment_count?: number;
  dependent_count?: number;
  dependency_count?: number;
}

export interface DesignIssue {
  id: string;
  type: "feature" | "bug" | "task" | "epic" | "message";
  title: string;
  status: "ready" | "in_progress" | "blocked" | "closed";
  p: number;
  assignee: string;
  labels: string[];
  blockedBy: string[];
  blocks: string[];
  desc: string;
  acceptance: string;
  notes: string;
  children?: string[];
  ts: number;
  created: number;
  createdBy: string;
  startedAt: number;
  commentCount: number;
  dependentCount: number;
  dependencyCount: number;
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
      (
        blockedByMap.get(dep.issue_id) ?? blockedByMap.set(dep.issue_id, []).get(dep.issue_id)!
      ).push(dep.depends_on_id);
      (
        blocksMap.get(dep.depends_on_id) ??
        blocksMap.set(dep.depends_on_id, []).get(dep.depends_on_id)!
      ).push(dep.issue_id);
    } else if (dep.type === "parent-child") {
      // issue_id is the child, depends_on_id is the parent.
      (
        childrenMap.get(dep.depends_on_id) ??
        childrenMap.set(dep.depends_on_id, []).get(dep.depends_on_id)!
      ).push(dep.issue_id);
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
      blockedBy: blockedByMap.get(issue.id) ?? [],
      blocks: blocksMap.get(issue.id) ?? [],
      desc: issue.description ?? "",
      acceptance: issue.acceptance_criteria ?? "",
      notes: issue.notes ?? "",
      ts: parseTs(issue.updated_at ?? issue.created_at),
      created: parseTs(issue.created_at),
      createdBy: mapAssignee(issue.created_by),
      startedAt: parseTs(issue.started_at),
      commentCount: issue.comment_count ?? 0,
      dependentCount: issue.dependent_count ?? 0,
      dependencyCount: issue.dependency_count ?? 0,
    };
    if (type === "epic") out.children = childrenMap.get(issue.id) ?? [];
    return out;
  });
}

if (import.meta.main) {
  const fixture: RawIssue[] = [
    {
      id: "www-epic",
      title: "Big Epic",
      description: "the epic",
      acceptance_criteria: "- [ ] ships\n- [ ] tested",
      notes: "some notes",
      status: "in_progress",
      priority: 0,
      issue_type: "epic",
      owner: "6991398+0x63616c@users.noreply.github.com",
      created_by: "6991398+0x63616c@users.noreply.github.com",
      created_at: "2026-06-01T12:00:00Z",
      labels: ["area:core"],
    },
    {
      id: "www-a",
      title: "First child (blocker)",
      status: "open",
      priority: 1,
      issue_type: "feature",
      owner: "alice@example.com",
      // child of the epic
      dependencies: [{ issue_id: "www-a", depends_on_id: "www-epic", type: "parent-child" }],
    },
    {
      id: "www-b",
      title: "Second child (blocked)",
      status: "blocked",
      priority: 5, // clamps to 4 (PRIO_META is P0..P4)
      issue_type: "bug",
      // child of the epic AND blocked by www-a
      dependencies: [
        { issue_id: "www-b", depends_on_id: "www-epic", type: "parent-child" },
        { issue_id: "www-b", depends_on_id: "www-a", type: "blocks" },
        // dangling edge that must be dropped:
        { issue_id: "www-b", depends_on_id: "www-ghost", type: "blocks" },
      ],
    },
  ];

  const mapped = mapIssues(fixture);
  console.log(JSON.stringify(mapped, null, 2));

  const epic = mapped.find((m) => m.id === "www-epic")!;
  const a = mapped.find((m) => m.id === "www-a")!;
  const b = mapped.find((m) => m.id === "www-b")!;

  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`SELF-CHECK FAILED: ${msg}`);
  };

  assert(epic.type === "epic", "epic type");
  assert(epic.children?.length === 2, "epic has 2 children");
  assert(epic.children!.includes("www-a") && epic.children!.includes("www-b"), "epic child ids");
  assert(epic.status === "in_progress", "epic status mapped");
  assert(epic.p === 0, "epic p=0");
  assert(epic.assignee === "0x63616c", "epic assignee from + email");
  assert(epic.acceptance === "- [ ] ships\n- [ ] tested", "epic acceptance mapped");
  assert(epic.notes === "some notes", "epic notes mapped");
  assert(epic.created === Date.parse("2026-06-01T12:00:00Z"), "epic created ts mapped");
  assert(epic.createdBy === "0x63616c", "epic createdBy from + email");

  assert(a.type === "feature", "a type");
  assert(a.status === "ready", "a status (open->ready)");
  assert(a.p === 1, "a p=1");
  assert(a.assignee === "alice", "a assignee plain email local-part");
  assert(a.blocks.length === 1 && a.blocks[0] === "www-b", "a blocks www-b");
  assert(a.blockedBy.length === 0, "a not blocked");

  assert(b.type === "bug", "b type");
  assert(b.status === "blocked", "b status");
  assert(b.p === 4, "b p clamped to 4");
  assert(b.acceptance === "" && b.notes === "", "b has empty acceptance/notes");
  assert(b.assignee === "", "b unassigned");
  assert(b.blockedBy.length === 1 && b.blockedBy[0] === "www-a", "b blockedBy www-a (ghost dropped)");
  assert(b.blocks.length === 0, "b blocks nothing");
  assert(b.children === undefined, "non-epic has no children field");

  console.log("\nALL SELF-CHECKS PASSED");
}
