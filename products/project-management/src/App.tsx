import { useEffect, useRef, useState } from "react";
import { RefreshCw, AlertCircle } from "lucide-react";
import type { BoardData, Issue } from "./types";
import { fetchBoard, triggerSync } from "./api";
import { IssueRow } from "./components/IssueRow";
import { IssueDetail } from "./components/IssueDetail";

type Filter = "all" | "ready" | "in_progress" | "blocked" | "closed";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "in_progress", label: "In Progress" },
  { id: "blocked", label: "Blocked" },
  { id: "closed", label: "Closed" },
];

export function App() {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  async function load() {
    try {
      const d = await fetchBoard();
      setData(d);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function sync() {
    setSyncing(true);
    await triggerSync().catch(() => {});
    await load();
    setSyncing(false);
  }

  useEffect(() => {
    void load();
    intervalRef.current = setInterval(load, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const issues = data?.issues ?? [];

  const filtered = issues.filter((i) => {
    if (filter !== "all" && i.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        i.title.toLowerCase().includes(q) ||
        i.id.toLowerCase().includes(q) ||
        i.labels.some((l) => l.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (a.p !== b.p) return a.p - b.p;
    return b.ts - a.ts;
  });

  const selected = selectedId ? issues.find((i) => i.id === selectedId) ?? null : null;

  const counts: Record<Filter, number> = {
    all: issues.length,
    ready: issues.filter((i) => i.status === "ready").length,
    in_progress: issues.filter((i) => i.status === "in_progress").length,
    blocked: issues.filter((i) => i.status === "blocked").length,
    closed: issues.filter((i) => i.status === "closed").length,
  };

  return (
    <div className="flex flex-col h-screen bg-black text-neutral-200">
      {/* Topbar */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 shrink-0">
        <h1 className="text-sm font-semibold text-neutral-100 mr-auto">Beads</h1>
        {data?.meta.lastError && (
          <span className="flex items-center gap-1 text-xs text-red-400">
            <AlertCircle className="w-3 h-3" />
            {data.meta.lastError.slice(0, 60)}
          </span>
        )}
        {data?.meta.lastFetchAt && (
          <span className="text-xs text-neutral-700">
            {new Date(data.meta.lastFetchAt).toLocaleTimeString()}
          </span>
        )}
        <button
          onClick={sync}
          disabled={syncing}
          className="p-1.5 rounded hover:bg-neutral-900 text-neutral-600 hover:text-neutral-300 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className={`flex flex-col border-r border-neutral-900 ${selected ? "w-[420px]" : "flex-1"} shrink-0 overflow-hidden transition-all`}>
          {/* Filters + search */}
          <div className="px-3 py-2 border-b border-neutral-900 space-y-2 shrink-0">
            <input
              type="search"
              placeholder="Search issues…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-700 focus:outline-none focus:border-neutral-600"
            />
            <div className="flex gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`flex-1 text-xs py-1 rounded transition-colors ${
                    filter === f.id
                      ? "bg-neutral-800 text-neutral-100"
                      : "text-neutral-600 hover:text-neutral-400 hover:bg-neutral-950"
                  }`}
                >
                  {f.label}
                  <span className="ml-1 text-neutral-700">{counts[f.id]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Issue list */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center h-32 text-neutral-600 text-sm">
                Loading…
              </div>
            )}
            {error && !loading && (
              <div className="p-4 text-sm text-red-400">{error}</div>
            )}
            {!loading && !error && sorted.length === 0 && (
              <div className="flex items-center justify-center h-32 text-neutral-700 text-sm">
                No issues
              </div>
            )}
            {sorted.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                selected={selectedId === issue.id}
                onClick={() => setSelectedId(selectedId === issue.id ? null : issue.id)}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-neutral-900 shrink-0">
            <p className="text-xs text-neutral-700">{sorted.length} of {issues.length} issues</p>
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="flex-1 overflow-hidden">
            <IssueDetail
              issue={selected}
              allIssues={issues}
              onClose={() => setSelectedId(null)}
              onSelect={setSelectedId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
