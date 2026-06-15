import { useEffect, useState } from "react";
import { X, MessageSquare, Link2, ChevronRight } from "lucide-react";
import type { Issue, Comment } from "../types";
import { fetchComments } from "../api";
import { StatusBadge } from "./StatusBadge";
import { PriorityDot } from "./PriorityDot";
import { timeAgo, formatDate } from "../lib/format";

interface Props {
  issue: Issue;
  allIssues: Issue[];
  onClose: () => void;
  onSelect: (id: string) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-neutral-900 pt-4 mt-4">
      <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm text-neutral-300 whitespace-pre-wrap leading-relaxed font-mono text-xs">
      {text}
    </div>
  );
}

function IssueLink({ id, allIssues, onSelect }: { id: string; allIssues: Issue[]; onSelect: (id: string) => void }) {
  const issue = allIssues.find((i) => i.id === id);
  return (
    <button
      onClick={() => onSelect(id)}
      className="flex items-center gap-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors group"
    >
      <ChevronRight className="w-3 h-3 text-neutral-700 group-hover:text-neutral-400" />
      <span className="font-mono text-xs text-neutral-600">{id}</span>
      {issue && <span className="truncate">{issue.title}</span>}
      {!issue && <span className="text-neutral-600 italic">unknown</span>}
    </button>
  );
}

export function IssueDetail({ issue, allIssues, onClose, onSelect }: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);

  useEffect(() => {
    if ((issue.commentCount ?? 0) === 0) {
      setComments([]);
      return;
    }
    setLoadingComments(true);
    fetchComments(issue.id)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setLoadingComments(false));
  }, [issue.id, issue.commentCount]);

  const inProgressFor =
    issue.startedAt && issue.status === "in_progress"
      ? timeAgo(issue.startedAt)
      : null;

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a] overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 p-4 border-b border-neutral-900">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <PriorityDot p={issue.p} />
            <span className="font-mono text-xs text-neutral-600">{issue.id}</span>
            <StatusBadge status={issue.status} />
            <span className="text-xs text-neutral-600 capitalize">{issue.type}</span>
          </div>
          <h2 className="text-base font-semibold text-neutral-100 leading-snug">{issue.title}</h2>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-neutral-600">
            {issue.assignee && <span>@{issue.assignee}</span>}
            {issue.created > 0 && <span>Created {formatDate(new Date(issue.created).toISOString())}</span>}
            {inProgressFor && <span className="text-amber-600">In progress {inProgressFor}</span>}
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-neutral-800 text-neutral-600 hover:text-neutral-300 transition-colors shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Labels */}
        {issue.labels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {issue.labels.map((l) => (
              <span key={l} className="text-xs px-2 py-0.5 rounded-full bg-neutral-900 text-neutral-400 border border-neutral-800">
                {l}
              </span>
            ))}
          </div>
        )}

        {/* Description */}
        {issue.desc && (
          <Section title="Description">
            <Markdown text={issue.desc} />
          </Section>
        )}

        {/* Acceptance Criteria */}
        {issue.acceptance && (
          <Section title="Acceptance Criteria">
            <Markdown text={issue.acceptance} />
          </Section>
        )}

        {/* Notes */}
        {issue.notes && (
          <Section title="Notes">
            <Markdown text={issue.notes} />
          </Section>
        )}

        {/* Deps */}
        {issue.blockedBy.length > 0 && (
          <Section title="Blocked By">
            <div className="space-y-1">
              {issue.blockedBy.map((id) => (
                <IssueLink key={id} id={id} allIssues={allIssues} onSelect={onSelect} />
              ))}
            </div>
          </Section>
        )}

        {issue.blocks.length > 0 && (
          <Section title="Blocks">
            <div className="space-y-1">
              {issue.blocks.map((id) => (
                <IssueLink key={id} id={id} allIssues={allIssues} onSelect={onSelect} />
              ))}
            </div>
          </Section>
        )}

        {issue.children && issue.children.length > 0 && (
          <Section title="Children">
            <div className="space-y-1">
              {issue.children.map((id) => (
                <IssueLink key={id} id={id} allIssues={allIssues} onSelect={onSelect} />
              ))}
            </div>
          </Section>
        )}

        {/* Comments */}
        {((issue.commentCount ?? 0) > 0 || comments.length > 0) && (
          <Section title={`Comments${comments.length ? ` (${comments.length})` : ""}`}>
            {loadingComments && (
              <p className="text-xs text-neutral-600 flex items-center gap-2">
                <MessageSquare className="w-3 h-3" /> Loading…
              </p>
            )}
            {!loadingComments && comments.length === 0 && (
              <p className="text-xs text-neutral-700 italic">No comments</p>
            )}
            <div className="space-y-3">
              {comments.map((c) => (
                <div key={c.id} className="bg-neutral-900/50 rounded p-3 border border-neutral-800">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-medium text-neutral-400">@{c.author}</span>
                    <span className="text-xs text-neutral-700">{formatDate(c.created_at)}</span>
                  </div>
                  <p className="text-sm text-neutral-300 whitespace-pre-wrap">{c.body}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Counts footer */}
        {((issue.dependentCount ?? 0) > 0 || (issue.dependencyCount ?? 0) > 0) && (
          <div className="flex gap-4 mt-4 pt-4 border-t border-neutral-900 text-xs text-neutral-700">
            {(issue.dependentCount ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <Link2 className="w-3 h-3" /> {issue.dependentCount} dependent{issue.dependentCount !== 1 ? "s" : ""}
              </span>
            )}
            {(issue.dependencyCount ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <Link2 className="w-3 h-3" /> {issue.dependencyCount} dependenc{issue.dependencyCount !== 1 ? "ies" : "y"}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
