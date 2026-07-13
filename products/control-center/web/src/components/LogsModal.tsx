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
 * Rows are uniform height and windowed: the store holds up to a million entries
 * and putting those in the DOM would jank a panel whose whole job is to look calm.
 * Expanding an entry therefore opens a detail pane rather than growing the row.
 *
 * Read-only by design: no copy, no clear. The logs are for reading here, on the
 * device, which is where the failure is.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BUILD_HASH } from "../config/build";
import { fuzzyMatch } from "../lib/log/fuzzy";
import { flushNow, getTail, subscribe } from "../lib/log/logger";
import * as store from "../lib/log/store";
import { MAX_BYTES, MAX_ENTRIES } from "../lib/log/store";
import { LOG_LEVELS, type LogEntry, type LogLevel } from "../lib/log/types";
import { Modal } from "./ui/Modal";

const ROW_HEIGHT = 26;
const LIST_HEIGHT = 520;
/** Rows rendered above/below the viewport, so a fast flick doesn't show blanks. */
const OVERSCAN = 8;
const PAGE_SIZE = 500;
/**
 * Cap on how many matches a search pulls back from disk in one go. A search runs
 * against the WHOLE store (up to a million entries), so it needs a ceiling , but
 * the ceiling has to be visible, because "2,000 matches" silently truncated to
 * look like "all the matches" is exactly the kind of quiet lie this viewer exists
 * to prevent. The footer says so when it bites.
 */
const SEARCH_LIMIT = 2_000;
/** Wait for typing to settle before hitting IndexedDB. */
const SEARCH_DEBOUNCE_MS = 200;

/** One height for every control in the toolbar, so the row actually lines up. */
const CONTROL_H = 36;
const RADIUS = 10;

/** The git SHA currently running. Entries carry their own , see the SHA column. */
const SHA = BUILD_HASH.slice(0, 7);

/**
 * One column template shared by the header and every row, so they cannot drift
 * apart. The payload column takes 1fr: it is the column with the actual
 * information in it, and the previous layout let the fixed columns hog width and
 * then clipped the payload, which is backwards.
 */
const GRID = "146px 46px 76px 58px minmax(230px, 32ch) 1fr";

/** A hair of breathing room so the timestamp doesn't crowd the level beside it. */
const TIME_CELL = { color: "var(--ink-3)", paddingRight: 6 } as const;

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: "var(--ink-3, #6b7280)",
  info: "var(--ink-2, #9ca3af)",
  warn: "#e0a02c",
  error: "#e5484d",
};

/**
 * Date AND time. History now spans a million entries and survives reloads, so it
 * routinely covers several days , a bare clock time makes "12:03" ambiguous
 * across them, which is useless precisely when you are scrolling back through an
 * incident. Year is omitted: it is dead weight on a panel you read at arm's length.
 */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const mon = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${mon}-${day} ${hh}:${mm}:${ss}.${ms}`;
}

/** Bytes as a short human string. Carries through to GB , the cap is 1 GB, and
 *  "1024.0 MB" is a unit that has given up. */
function formatBytes(n: number): string {
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (n < KB) return `${n} B`;
  if (n < MB) return `${Math.round(n / KB)} KB`;
  if (n < GB) return `${(n / MB).toFixed(1)} MB`;
  return `${(n / GB).toFixed(2)} GB`;
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

export interface LogsModalProps {
  open: boolean;
  onClose: () => void;
}

export function LogsModal({ open, onClose }: LogsModalProps) {
  // Live tail. useSyncExternalStore keeps this correct under concurrent React,
  // and getTail() is memoized behind a dirty flag so this is not a re-render
  // storm even while the app is logging steadily.
  const tail = useSyncExternalStore(subscribe, getTail);

  // Levels are a SET, not a floor: on a polling dashboard the debug firehose is
  // what you want OFF while still seeing info, which "warn and above" cannot say.
  const [levels, setLevels] = useState<LogLevel[]>([...LOG_LEVELS]);
  const [search, setSearch] = useState("");
  const [older, setOlder] = useState<LogEntry[]>([]);
  const [historyCount, setHistoryCount] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const toggleLevel = useCallback((level: LogLevel) => {
    setLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level],
    );
  }, []);

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

  /**
   * Search runs against the STORE, not just what happens to be loaded.
   *
   * This is the whole point of keeping a million entries on disk. Filtering only
   * the in-memory set would mean typing "tesla", seeing nothing, and concluding it
   * never happened , while 900k unsearched entries sat on disk. An empty result
   * would be indistinguishable from "no matches anywhere in history", which is a
   * quiet lie of exactly the kind this viewer exists to prevent.
   */
  useEffect(() => {
    if (!open) return;
    const needle = search.trim();
    if (!needle) {
      // Back to the live tail. Any pages fetched for a previous search are stale.
      setOlder([]);
      setSearchTruncated(false);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        await flushNow();
        const hits = await store.query({
          search: needle,
          levels: levels.length === LOG_LEVELS.length ? undefined : levels,
          limit: SEARCH_LIMIT,
        });
        if (cancelled) return;
        setOlder(hits);
        setSearchTruncated(hits.length >= SEARCH_LIMIT);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setSearching(false);
    };
  }, [open, search, levels]);

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
    const needle = search.trim();
    return (
      deduped
        .filter((e) => levels.includes(e.level))
        // Same fuzzy matcher the store pages with, so what you see and what "Load
        // older" fetches cannot disagree about what "matches".
        .filter((e) => !needle || fuzzyMatch(`${e.source} ${e.msg} ${oneLine(e.data)}`, needle))
        .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    );
  }, [older, tail, levels, search]);

  // Counted over everything loaded, BEFORE the level filter , the point of the
  // tally is to tell you there are 12 errors even while you have errors hidden.
  const counts = useMemo(() => {
    const tally: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    const seen = new Set<string>();
    for (const e of [...older, ...tail]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      tally[e.level] += 1;
    }
    return tally;
  }, [older, tail]);

  const oldestLoadedId = rows.length > 0 ? rows[rows.length - 1].id : undefined;

  const loadOlder = useCallback(async () => {
    setLoadingOlder(true);
    try {
      await flushNow();
      const page = await store.query({
        before: oldestLoadedId,
        levels: levels.length === LOG_LEVELS.length ? undefined : levels,
        search: search.trim() || undefined,
        limit: PAGE_SIZE,
      });
      setOlder((prev) => [...page, ...prev]);
      setHistoryCount(await store.count());
      setBytes(await store.bytesUsed());
    } finally {
      setLoadingOlder(false);
    }
  }, [oldestLoadedId, levels, search]);

  // Windowing: only the visible slice is in the DOM. The spacer div carries the
  // full scroll height so the scrollbar still reflects the real list length.
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(LIST_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const visible = rows.slice(first, first + visibleCount);

  return (
    <Modal open={open} onClose={onClose} title="Logs" width={1240} maxHeight={900}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Controls. Every control in this row is exactly CONTROL_H tall and is
            stretched to it, rather than each one sizing itself from its own font
            and padding , which is what made the chips, the search field and the
            buttons all land on slightly different heights. */}
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            gap: 8,
            height: CONTROL_H,
          }}
        >
          {LOG_LEVELS.map((level) => (
            <LevelChip
              key={level}
              level={level}
              active={levels.includes(level)}
              onToggle={() => toggleLevel(level)}
            />
          ))}
          <input
            type="search"
            value={search}
            placeholder="Search message, source, payload…"
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              minWidth: 200,
              height: "100%",
              padding: "0 12px",
              margin: 0,
              background: "var(--nest)",
              border: "1px solid var(--hair)",
              borderRadius: RADIUS,
              color: "var(--ink-1)",
              fontFamily: "var(--mono, ui-monospace, monospace)",
              fontSize: 13,
            }}
          />
          <ToolbarButton onClick={() => void loadOlder()} disabled={loadingOlder}>
            {loadingOlder ? "Loading…" : "Load older"}
          </ToolbarButton>
        </div>

        {/* Header + list share one bordered box. The header sits OUTSIDE the
            scroll container rather than sticky inside it: a sticky header still
            lets the first row slide under it mid-scroll, which is exactly the
            clipping this replaces. */}
        <div
          style={{
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            borderRadius: RADIUS,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              gap: 10,
              alignItems: "center",
              height: 28,
              padding: "0 10px",
              borderBottom: "1px solid var(--hair)",
              fontFamily: "var(--ui)",
              fontSize: 10,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            <span style={{ paddingRight: 6 }}>Date / time</span>
            <span>Level</span>
            <span>Source</span>
            <span>Git SHA</span>
            <span>Message</span>
            <span>Payload</span>
          </div>
          <div
            ref={listRef}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            style={{
              height: LIST_HEIGHT,
              overflowY: "auto",
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

        {/* Left: what is loaded and how close rotation is to dropping the oldest
            history , size is shown against the cap because "12 MB" alone means
            nothing on a wall panel. Right: the level tally, which is counted
            BEFORE the level filter is applied, so switching ERROR off still tells
            you how many errors are sitting there. That is the number you want on
            a panel you glance at. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontFamily: "var(--ui)",
            fontSize: 12,
            color: "var(--ink-3)",
          }}
        >
          <span>
            {rows.length.toLocaleString()} shown ·{" "}
            {search.trim()
              ? searching
                ? `searching all ${historyCount.toLocaleString()} on disk…`
                : `searched all ${historyCount.toLocaleString()} on disk${
                    searchTruncated ? ` (first ${SEARCH_LIMIT.toLocaleString()} matches)` : ""
                  }`
              : `${tail.length.toLocaleString()} in memory · ${historyCount.toLocaleString()} / ${MAX_ENTRIES.toLocaleString()} on disk`}{" "}
            · {formatBytes(bytes)} / {formatBytes(MAX_BYTES)} · git sha{" "}
            <span style={{ fontFamily: "var(--mono, ui-monospace, monospace)" }}>{SHA}</span>
          </span>
          <span style={{ display: "flex", gap: 12, whiteSpace: "nowrap" }}>
            {LOG_LEVELS.map((level) => (
              <span key={level} style={{ color: LEVEL_COLOR[level] }}>
                {counts[level].toLocaleString()} {level}
              </span>
            ))}
          </span>
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
        // Same GRID as the header, so the columns line up by construction rather
        // than by two sets of hand-tuned widths that drift apart.
        display: "grid",
        gridTemplateColumns: GRID,
        gap: 10,
        alignItems: "center",
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
      }}
    >
      <span style={TIME_CELL}>{formatTime(entry.ts)}</span>
      <span style={{ color: LEVEL_COLOR[entry.level] }}>{entry.level}</span>
      <span style={ELLIPSIS}>{entry.source}</span>
      <span style={{ color: "var(--ink-3)", opacity: 0.55 }}>{entry.sha}</span>
      <span style={{ ...ELLIPSIS, color: "var(--ink-1)" }}>{entry.msg}</span>
      {/* The payload gets every remaining pixel: it is the column carrying the
          answer (status codes, failing keys, durations), and it was the one being
          clipped while the fixed columns sat half-empty. */}
      <span style={{ ...ELLIPSIS, color: "var(--ink-3)" }}>{oneLine(entry.data)}</span>
    </button>
  );
}

const ELLIPSIS = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

/**
 * A level filter chip. Independently toggleable , the levels are a set, not a
 * threshold. An inactive chip stays legible (dimmed, not hidden) so you can see
 * at a glance which levels you have switched off, rather than wondering why the
 * list looks empty.
 */
function LevelChip({
  level,
  active,
  onToggle,
}: {
  level: LogLevel;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      style={{
        height: "100%",
        padding: "0 14px",
        background: active ? "var(--nest)" : "transparent",
        border: `1px solid ${active ? "var(--hair)" : "transparent"}`,
        borderRadius: RADIUS,
        fontFamily: "var(--mono, ui-monospace, monospace)",
        fontSize: 12,
        letterSpacing: 0.5,
        color: active ? LEVEL_COLOR[level] : "var(--ink-3)",
        opacity: active ? 1 : 0.45,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {level.toUpperCase()}
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
        height: "100%",
        padding: "0 14px",
        background: "var(--nest)",
        border: "1px solid var(--hair)",
        borderRadius: RADIUS,
        fontFamily: "var(--ui)",
        fontSize: 13,
        color: "var(--ink-2)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}
