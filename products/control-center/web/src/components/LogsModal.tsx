/**
 * LogsModal , the debug log viewer.
 *
 * This is the ONLY window into the running app. The wall panel is a TestFlight
 * Capacitor build, so `isInspectable` is false and Safari Web Inspector cannot
 * attach even with a Mac and a cable; there is no Chromium, so there is no
 * chrome://inspect either. Standing at the panel, this modal or nothing.
 *
 * Two data sources, deliberately:
 *   - the in-memory ring (lib/log/logger.getTail) is the live tail. It renders
 *     instantly with no await, which is what you want when you have opened this
 *     because something is on fire right now.
 *   - IndexedDB (lib/log/store.query) is the history, paged in on demand. It is
 *     the only source that survives the kiosk watchdog's reloads.
 *
 * Rows are uniform height and windowed: the store holds up to 100k entries and
 * putting those in the DOM would jank a panel whose whole job is to look calm.
 * Expanding an entry therefore opens a detail pane rather than growing the row.
 *
 * Copy/export is not a nicety here , with no devtools and no log shipping, the
 * clipboard is the only way anything leaves this device.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getLogPayloads, setLogPayloads, subscribeLogPayloads } from "../lib/log/config";
import { flushNow, getTail, subscribe } from "../lib/log/logger";
import * as store from "../lib/log/store";
import { MAX_BYTES, MAX_ENTRIES } from "../lib/log/store";
import { LEVEL_RANK, type LogEntry, type LogLevel } from "../lib/log/types";
import { Modal } from "./ui/Modal";
import { Segmented } from "./ui/Segmented";
import { Switch } from "./ui/Switch";

const ROW_HEIGHT = 26;
const LIST_HEIGHT = 520;
/** Rows rendered above/below the viewport, so a fast flick doesn't show blanks. */
const OVERSCAN = 8;
const PAGE_SIZE = 500;

const LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
  { value: "debug", label: "all" },
  { value: "info", label: "info+" },
  { value: "warn", label: "warn+" },
  { value: "error", label: "errors" },
];

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: "var(--ink-3, #6b7280)",
  info: "var(--ink-2, #9ca3af)",
  warn: "#e0a02c",
  error: "#e5484d",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/** Bytes as a short human string. KB/MB, one decimal once we're past a MB. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function oneLine(data: unknown): string {
  if (data === undefined) return "";
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function toText(entries: LogEntry[]): string {
  return entries
    .map((e) => {
      const suffix = e.data === undefined ? "" : ` ${oneLine(e.data)}`;
      return `${new Date(e.ts).toISOString()} ${e.level.toUpperCase().padEnd(5)} ${e.source} ${e.msg}${suffix}`;
    })
    .join("\n");
}

export interface LogsModalProps {
  open: boolean;
  onClose: () => void;
}

export function LogsModal({ open, onClose }: LogsModalProps) {
  // Live tail. useSyncExternalStore keeps this correct under concurrent React,
  // and getTail() is memoized behind a dirty flag so this is not a re-render
  // storm even while the app is logging steadily.
  const tail = useSyncExternalStore(subscribe, getTail);
  const payloads = useSyncExternalStore(subscribeLogPayloads, getLogPayloads);

  const [minLevel, setMinLevel] = useState<LogLevel>("debug");
  const [search, setSearch] = useState("");
  const [older, setOlder] = useState<LogEntry[]>([]);
  const [historyCount, setHistoryCount] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset paging whenever the modal is reopened: the tail has moved on, and
  // stale `older` pages would leave a hole between them and the live entries.
  useEffect(() => {
    if (!open) return;
    setOlder([]);
    setSelected(null);
    setScrollTop(0);
    listRef.current?.scrollTo({ top: 0 });
    // Push anything still queued to disk so the history count is honest.
    void flushNow().then(async () => {
      setHistoryCount(await store.count());
      setBytes(await store.bytesUsed());
    });
  }, [open]);

  // Newest first: this is opened to answer "what just happened", so the answer
  // should be the first row, not 5000 rows down.
  const rows = useMemo(() => {
    const merged = [...older, ...tail];
    const seen = new Set<string>();
    const deduped: LogEntry[] = [];
    // `older` can overlap the tail when a page boundary lands inside the ring.
    for (const e of merged) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      deduped.push(e);
    }
    const needle = search.trim().toLowerCase();
    return deduped
      .filter((e) => LEVEL_RANK[e.level] >= LEVEL_RANK[minLevel])
      .filter((e) => {
        if (!needle) return true;
        if (e.msg.toLowerCase().includes(needle)) return true;
        if (e.source.toLowerCase().includes(needle)) return true;
        return oneLine(e.data).toLowerCase().includes(needle);
      })
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }, [older, tail, minLevel, search]);

  const oldestLoadedId = rows.length > 0 ? rows[rows.length - 1].id : undefined;

  const loadOlder = useCallback(async () => {
    setLoadingOlder(true);
    try {
      await flushNow();
      const page = await store.query({
        before: oldestLoadedId,
        minLevel: minLevel === "debug" ? undefined : minLevel,
        search: search.trim() || undefined,
        limit: PAGE_SIZE,
      });
      setOlder((prev) => [...page, ...prev]);
      setHistoryCount(await store.count());
      setBytes(await store.bytesUsed());
    } finally {
      setLoadingOlder(false);
    }
  }, [oldestLoadedId, minLevel, search]);

  const copyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(toText(rows));
    } catch {
      // Clipboard can be denied; the user sees nothing change, which is the same
      // failure mode as a browser blocking it. Not worth a toast on a wall panel.
    }
  }, [rows]);

  const clearAll = useCallback(async () => {
    await store.clear();
    setOlder([]);
    setHistoryCount(0);
    setBytes(0);
  }, []);

  // Windowing: only the visible slice is in the DOM. The spacer div carries the
  // full scroll height so the scrollbar still reflects the real list length.
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(LIST_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const visible = rows.slice(first, first + visibleCount);

  return (
    <Modal open={open} onClose={onClose} title="Logs" width={1240} maxHeight={900}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Segmented
            label="Level"
            options={LEVEL_OPTIONS}
            value={minLevel}
            onChange={(v) => setMinLevel(v)}
          />
          <input
            type="search"
            value={search}
            placeholder="filter…"
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              minWidth: 200,
              padding: "7px 10px",
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              borderRadius: 10,
              color: "var(--ink-1)",
              fontFamily: "var(--ui)",
              fontSize: 13,
            }}
          />
          {/* Switch has no visible text of its own (see ui/Switch.tsx), and a bare
              toggle in a toolbar is unreadable , nobody standing at the panel can
              guess that this one decides whether request bodies get written to
              disk. So it carries its own label. */}
          <span
            title="Also record tRPC request/response bodies. Off by default: bodies persist to disk, and would include camera URLs and tokens."
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "var(--ui)",
              fontSize: 13,
              color: "var(--ink-2)",
              whiteSpace: "nowrap",
            }}
          >
            Payloads
            <Switch label="Log request payloads" checked={payloads} onChange={setLogPayloads} />
          </span>
          <ToolbarButton onClick={copyAll}>Copy</ToolbarButton>
          <ToolbarButton onClick={() => void loadOlder()} disabled={loadingOlder}>
            {loadingOlder ? "Loading…" : "Load older"}
          </ToolbarButton>
          <ToolbarButton onClick={() => void clearAll()}>Clear</ToolbarButton>
        </div>

        {/* list */}
        <div
          ref={listRef}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          style={{
            height: LIST_HEIGHT,
            overflowY: "auto",
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            borderRadius: 10,
            fontFamily: "var(--mono, ui-monospace, monospace)",
            fontSize: 12,
          }}
        >
          {rows.length === 0 ? (
            <div style={{ padding: 16, color: "var(--ink-3)", fontFamily: "var(--ui)" }}>
              No entries match.
            </div>
          ) : (
            <div style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}>
              <div style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
                {visible.map((entry) => (
                  <LogRow
                    key={entry.id}
                    entry={entry}
                    selected={selected?.id === entry.id}
                    onSelect={() => setSelected(entry)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* detail */}
        {selected ? (
          <pre
            style={{
              margin: 0,
              maxHeight: 160,
              overflow: "auto",
              padding: 10,
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              borderRadius: 10,
              fontFamily: "var(--mono, ui-monospace, monospace)",
              fontSize: 12,
              color: "var(--ink-2)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {JSON.stringify(selected, null, 2)}
            {selected.truncated ? "\n\n[data truncated at capture time]" : ""}
          </pre>
        ) : null}

        {/* Size is shown against the cap, not on its own: "12 MB" means nothing on
            a wall panel, "12 MB / 50 MB" tells you how close rotation is to
            dropping your oldest history. Same byte count that drives eviction. */}
        <div style={{ fontFamily: "var(--ui)", fontSize: 12, color: "var(--ink-3)" }}>
          {rows.length.toLocaleString()} shown · {tail.length.toLocaleString()} in memory ·{" "}
          {historyCount.toLocaleString()} / {MAX_ENTRIES.toLocaleString()} on disk ·{" "}
          {formatBytes(bytes)} / {formatBytes(MAX_BYTES)}
        </div>
      </div>
    </Modal>
  );
}

function LogRow({
  entry,
  selected,
  onSelect,
}: {
  entry: LogEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "baseline",
        width: "100%",
        height: ROW_HEIGHT,
        padding: "0 10px",
        border: "none",
        background: selected ? "var(--hair)" : "transparent",
        color: "var(--ink-2)",
        fontFamily: "inherit",
        fontSize: "inherit",
        textAlign: "left",
        cursor: "pointer",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      <span style={{ color: "var(--ink-3)", flexShrink: 0 }}>{formatTime(entry.ts)}</span>
      <span style={{ color: LEVEL_COLOR[entry.level], width: 40, flexShrink: 0 }}>
        {entry.level}
      </span>
      <span style={{ color: "var(--ink-3)", width: 130, flexShrink: 0, overflow: "hidden" }}>
        {entry.source}
      </span>
      <span style={{ color: "var(--ink-1)", flexShrink: 0 }}>{entry.msg}</span>
      <span style={{ color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis" }}>
        {oneLine(entry.data)}
      </span>
    </button>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "7px 12px",
        background: "var(--nest)",
        border: "1px solid var(--hair)",
        borderRadius: 10,
        fontFamily: "var(--ui)",
        fontSize: 13,
        color: "var(--ink-2)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
