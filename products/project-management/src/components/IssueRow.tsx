import type { Issue } from "../types";
import { StatusBadge } from "./StatusBadge";
import { PriorityDot } from "./PriorityDot";
import { timeAgo } from "../lib/format";

interface Props {
  issue: Issue;
  selected: boolean;
  onClick: () => void;
}

const TYPE_ICON: Record<Issue["type"], string> = {
  feature: "✦",
  bug: "⬡",
  task: "◻",
  epic: "◈",
  message: "◉",
};

export function IssueRow({ issue, selected, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-neutral-900 flex items-start gap-3 hover:bg-neutral-950 transition-colors ${
        selected ? "bg-neutral-950 border-l-2 border-l-blue-500" : "border-l-2 border-l-transparent"
      }`}
    >
      <span className="text-neutral-600 text-xs mt-0.5 w-3 shrink-0">{TYPE_ICON[issue.type]}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <PriorityDot p={issue.p} />
          <span className="text-xs font-mono text-neutral-600">{issue.id}</span>
          <StatusBadge status={issue.status} />
          {(issue.commentCount ?? 0) > 0 && (
            <span className="text-xs text-neutral-600">💬 {issue.commentCount}</span>
          )}
        </div>
        <p className="text-sm text-neutral-200 truncate leading-snug">{issue.title}</p>
        {issue.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {issue.labels.map((l) => (
              <span key={l} className="text-xs px-1.5 py-0.5 rounded bg-neutral-900 text-neutral-500 border border-neutral-800">
                {l}
              </span>
            ))}
          </div>
        )}
        {issue.ts > 0 && (
          <p className="text-xs text-neutral-700 mt-1">{timeAgo(issue.ts)}</p>
        )}
      </div>
    </button>
  );
}
