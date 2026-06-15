export interface Issue {
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
  commentCount?: number;
  dependentCount?: number;
  dependencyCount?: number;
  startedAt?: number;
}

export interface BoardData {
  issues: Issue[];
  meta: {
    lastSyncAt: string | null;
    lastFetchAt: string | null;
    lastError: string | null;
    syncing: boolean;
    count: number;
  };
}

export interface Comment {
  id: string;
  body: string;
  author: string;
  created_at: string;
}
