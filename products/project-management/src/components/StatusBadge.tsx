import type { Issue } from "../types";

const CONFIG = {
  ready: { label: "Ready", className: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
  in_progress: { label: "In Progress", className: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
  blocked: { label: "Blocked", className: "bg-red-500/15 text-red-400 border-red-500/20" },
  closed: { label: "Closed", className: "bg-neutral-500/15 text-neutral-500 border-neutral-500/20" },
};

export function StatusBadge({ status }: { status: Issue["status"] }) {
  const c = CONFIG[status] ?? CONFIG.ready;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${c.className}`}>
      {c.label}
    </span>
  );
}
