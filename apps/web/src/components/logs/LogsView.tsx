/**
 * LogsView , the debug log viewer body (presentational, no Modal chrome).
 *
 * This is the ONLY window into the running app. The wall panel is a TestFlight
 * Capacitor build, so `isInspectable` is false and Safari Web Inspector cannot
 * attach even with a Mac and a cable; there is no Chromium, so there is no
 * chrome://inspect either. Standing at the panel, this view or nothing.
 *
 * It renders inside the Logs settings page (a `fill` page that hands it a
 * definite height), so unlike the old modal it has no `open` prop , it only ever
 * mounts while visible, and every effect runs unconditionally from mount.
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
 * Read-only, with one escape hatch: no copy, no clear, but on the native device
 * you can Export , this shares the on-disk native log mirror files
 * (`cc-logs/*.jsonl`) via the iOS share sheet. Nothing is serialized at share
 * time; we hand the OS the files the mirror already wrote, so export cannot spike
 * memory or fail on a large store. Off-device the button is disabled.
 */

import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BUILD_HASH } from "../../config/build";
import { getDeviceName } from "../../lib/device-name";
import { fuzzyMatch } from "../../lib/log/fuzzy";
import { flushNow, log } from "../../lib/log/logger";
import {
  deleteExportFile,
  getExportFileUri,
  getMirrorFileUris,
  writeExportChunk,
} from "../../lib/log/native";
import * as store from "../../lib/log/store";
import { MAX_BYTES, MAX_ENTRIES } from "../../lib/log/store";
import { LOG_LEVELS, type LogEntry, type LogLevel } from "../../lib/log/types";
import { useLogTail } from "../../lib/log/useLogTail";
import { formatSha } from "../../lib/short-sha";

const ROW_HEIGHT = 26;
/**
 * Fallback list height, used only until the list has been measured (first paint,
 * and in environments without ResizeObserver). The real height comes from the
 * flex layout: the list is the ONLY thing in this view that scrolls, so it takes
 * whatever vertical space the toolbar, detail pane and footer leave behind.
 */
const LIST_HEIGHT = 520;
/** Rows rendered above/below the viewport, so a fast flick doesn't show blanks. */
const OVERSCAN = 8;
const PAGE_SIZE = 500;
/**
 * Page size for the filtered export's store walk. Bigger than the viewer's page
 * because nothing renders , each page is serialized to JSONL and appended to the
 * export file, so the bound is transient memory per chunk, not DOM weight.
 */
const EXPORT_PAGE = 2_000;
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
const SHA = formatSha(BUILD_HASH);

/**
 * One column template shared by the header and every row, so they cannot drift
 * apart. The payload column takes 1fr: it is the column with the actual
 * information in it, and the previous layout let the fixed columns hog width and
 * then clipped the payload, which is backwards.
 */
const GRID = "112px 64px 46px 76px 58px 96px minmax(230px, 32ch) 1fr";

/**
 * The device that emitted an entry. Read-time fallback for rows written before
 * `deviceName` existed and somehow skipped the store migration (private mode /
 * quota / degraded store): the store is per-device, so this device's resolved
 * name is the honest attribution, and nothing renders blank.
 */
function deviceLabel(entry: LogEntry): string {
  return entry.deviceName || getDeviceName();
}

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
  return `${mon}-${day} ${hh}:${mm}:${ss}`;
}

/**
 * "How long ago" at a glance. The absolute timestamp answers "when exactly";
 * this answers the question actually asked mid-incident, "was that just now or
 * yesterday", without mental date arithmetic at arm's length.
 */
function formatAge(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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

export interface LogsViewProps {
  /**
   * Whether the native Export affordance is enabled. Defaults to the real
   * platform gate; only Storybook/tests pass it to render the enabled visual
   * off-device (share itself is a native-only OS surface).
   */
  nativeExport?: boolean;
}

export function LogsView({ nativeExport = Capacitor.isNativePlatform() }: LogsViewProps = {}) {
  // Live tail , the shared ring seam (snapshot-correct under concurrent React,
  // memoized behind a dirty flag, so no re-render storm while logging steadily).
  const tail = useLogTail();

  // Levels are a SET, not a floor: on a polling dashboard the debug firehose is
  // what you want OFF while still seeing info, which "warn and above" cannot say.
  const [levels, setLevels] = useState<LogLevel[]>([...LOG_LEVELS]);
  const [search, setSearch] = useState("");
  const [older, setOlder] = useState<LogEntry[]>([]);
  const [historyCount, setHistoryCount] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** 0..1 while a filtered export is paging the store; null otherwise. */
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [listHeight, setListHeight] = useState(LIST_HEIGHT);
  const listRef = useRef<HTMLDivElement>(null);
  /** True once a page comes back short , there is no more history to fetch. */
  const [exhausted, setExhausted] = useState(false);
  /** Re-entrancy guard for scroll-driven paging; state alone lags the events. */
  const loadingRef = useRef(false);

  // Clock for the Age column. Ticks for the view's whole lifetime; the windowed
  // list keeps the per-second re-render to a few dozen rows.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // The list sizes itself from the flex layout, so windowing has to follow the
  // measured height rather than a constant , otherwise opening the detail pane
  // shrinks the viewport and we keep rendering rows for the taller one.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    setListHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setListHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toggleLevel = useCallback((level: LogLevel) => {
    setLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level],
    );
  }, []);

  /**
   * Double-tap solo, mixer-desk style: solo the tapped level; double-tap the
   * level that is already solo to bring everything back. The two single-click
   * toggles that fire before dblclick cancel each other out (toggle twice is a
   * no-op), so the pair of handlers composes without debouncing.
   */
  const soloLevel = useCallback((level: LogLevel) => {
    setLevels((prev) => (prev.length === 1 && prev[0] === level ? [...LOG_LEVELS] : [level]));
  }, []);

  // Reset paging on mount: the tail has moved on since a previous session, and
  // stale `older` pages would leave a hole between them and the live entries.
  useEffect(() => {
    setOlder([]);
    setSelected(null);
    setScrollTop(0);
    setExhausted(false);
    listRef.current?.scrollTo({ top: 0 });
    // Push anything still queued to disk so the history count is honest.
    void flushNow().then(async () => {
      setHistoryCount(await store.count());
      setBytes(await store.bytesUsed());
    });
  }, []);

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
    const needle = search.trim();
    const subset = levels.length < LOG_LEVELS.length;
    if (!needle && !subset) {
      // Back to the live tail. Any pages fetched for a previous filter are stale.
      setOlder([]);
      setSearchTruncated(false);
      setSearching(false);
      setExhausted(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    // A level chip is a click, not typing , no debounce, fetch immediately.
    const limit = needle ? SEARCH_LIMIT : PAGE_SIZE;
    const timer = setTimeout(
      async () => {
        try {
          await flushNow();
          const hits = await store.query({
            search: needle || undefined,
            levels: subset ? levels : undefined,
            limit,
          });
          if (cancelled) return;
          setOlder(hits);
          setSearchTruncated(needle ? hits.length >= SEARCH_LIMIT : false);
          setExhausted(hits.length < limit);
        } finally {
          if (!cancelled) setSearching(false);
        }
      },
      needle ? SEARCH_DEBOUNCE_MS : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setSearching(false);
    };
  }, [search, levels]);

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
        .filter(
          (e) =>
            !needle ||
            fuzzyMatch(`${e.source} ${e.msg} ${deviceLabel(e)} ${oneLine(e.data)}`, needle),
        )
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
    if (loadingRef.current) return;
    loadingRef.current = true;
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
      setExhausted(page.length < PAGE_SIZE);
      setHistoryCount(await store.count());
      setBytes(await store.bytesUsed());
    } finally {
      loadingRef.current = false;
      setLoadingOlder(false);
    }
  }, [oldestLoadedId, levels, search]);

  // Export via the OS share sheet. Two shapes, chosen by the level chips:
  //
  //   - ALL levels selected: share the on-disk native mirror files as-is , no
  //     IndexedDB read, no serialization, so the rescue path cannot spike memory
  //     or fail on a million-row store. Instant, but it is the whole ~128 MB
  //     mirror.
  //   - a SUBSET selected: page the store through the level filter and stream
  //     matching entries into a scratch file, then share that. Chunked on both
  //     ends (query paging in, appendFile out) so memory stays bounded, and
  //     countByLevels gives an exact total up front , the progress on the button
  //     is real, not a spinner. Deselecting debug is the difference between a
  //     100 MB export and one that actually fits in an iMessage.
  const handleExport = useCallback(async () => {
    const exportLog = log.child("logs-export");
    setExporting(true);
    try {
      const { Share } = await import("@capacitor/share");

      if (levels.length < LOG_LEVELS.length) {
        // Filtered export. Flush first so what exports is what the footer counts.
        await flushNow();
        const total = await store.countByLevels(levels);
        if (total === 0) {
          exportLog.warn("no entries at selected levels", { levels });
          return;
        }
        setExportProgress(0);
        let before: string | undefined;
        let written = 0;
        for (;;) {
          const page = await store.query({ levels, before, limit: EXPORT_PAGE });
          if (page.length === 0) break;
          if (!(await writeExportChunk(page, written === 0))) {
            exportLog.warn("no native filesystem for filtered export");
            return;
          }
          written += page.length;
          before = page[page.length - 1].id;
          setExportProgress(Math.min(1, written / total));
          if (page.length < EXPORT_PAGE) break;
        }
        const uri = await getExportFileUri();
        if (!uri) {
          exportLog.error("export file missing after write", { written });
          return;
        }
        await Share.share({
          title: "Control Center logs",
          text: `Control Center logs (${levels.join(", ")})`,
          files: [uri],
          dialogTitle: "Export logs",
        });
        exportLog.info("shared filtered export", { entries: written, levels });
        return;
      }

      const uris = await getMirrorFileUris();
      if (uris.length === 0) {
        // Mirror hasn't flushed a batch yet (or we're off-device). Honest record,
        // no error dialog , there is simply nothing on disk to hand the OS.
        exportLog.warn("no mirror files to export");
        return;
      }
      await Share.share({
        title: "Control Center logs",
        text: "Control Center native log mirror",
        files: uris,
        dialogTitle: "Export logs",
      });
      exportLog.info("shared", { files: uris.length });
    } catch (err) {
      // Cancelling the share sheet rejects , that is a user choice, not a
      // failure. Everything else (missing pod, bridge error) is a real error.
      const message = err instanceof Error ? err.message : String(err);
      const code =
        typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "";
      if (/cancel/i.test(message) || /cancel/i.test(code)) {
        exportLog.debug("share cancelled");
        return;
      }
      exportLog.error("share failed", { message });
    } finally {
      // The share sheet has closed (iOS copies the payload on share), so the
      // scratch file is dead weight , reclaim the disk immediately rather than
      // leaving a filtered dump around until the next export truncates it.
      void deleteExportFile();
      setExporting(false);
      setExportProgress(null);
    }
  }, [levels]);

  // Windowing: only the visible slice is in the DOM. The spacer div carries the
  // full scroll height so the scrollbar still reflects the real list length.
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(listHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const visible = rows.slice(first, first + visibleCount);

  return (
    // Full height of the host, and nothing here scrolls except the log list
    // itself , the toolbar, detail pane and footer stay pinned. A page that
    // scrolls as a whole is wrong for a viewer you open mid-incident: the level
    // tally and the search box slide off exactly when you reach for them.
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        height: "100%",
        minHeight: 0,
      }}
    >
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
          flexShrink: 0,
        }}
      >
        {LOG_LEVELS.map((level) => (
          <LevelChip
            key={level}
            level={level}
            active={levels.includes(level)}
            onToggle={() => toggleLevel(level)}
            onSolo={() => soloLevel(level)}
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
        <ToolbarButton
          onClick={() => void handleExport()}
          disabled={!nativeExport || exporting}
          title={
            nativeExport
              ? levels.length < LOG_LEVELS.length
                ? `Export only ${levels.join(" + ")} entries`
                : "Share the on-disk log mirror files (all levels)"
              : "Export available on the device only"
          }
          // The button IS the progress bar during a filtered export: the fill
          // sweeps left to right behind the percentage label.
          progress={exportProgress ?? undefined}
        >
          {exportProgress !== null
            ? `Exporting ${Math.round(exportProgress * 100)}%`
            : exporting
              ? "Exporting…"
              : "Export"}
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
          // The box owns the leftover space; the list inside it is the scroller.
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 160,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 10,
            alignItems: "center",
            height: 28,
            flexShrink: 0,
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
          <span>Age</span>
          <span>Level</span>
          <span>Source</span>
          <span>Git SHA</span>
          <span>Device</span>
          <span>Message</span>
          <span>Payload</span>
        </div>
        <div
          ref={listRef}
          // Infinite scroll: within two screens of the bottom, page in the next
          // chunk of history unmanned. No "Load older" button , reaching for it
          // mid-incident was friction exactly when it mattered.
          onScroll={(e) => {
            const el = e.currentTarget;
            setScrollTop(el.scrollTop);
            if (
              !exhausted &&
              !loadingRef.current &&
              el.scrollTop + el.clientHeight >= el.scrollHeight - listHeight * 2
            ) {
              void loadOlder();
            }
          }}
          style={{
            flex: 1,
            minHeight: 0,
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
                    now={now}
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
            flexShrink: 0,
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
          flexShrink: 0,
          fontFamily: "var(--ui)",
          fontSize: 12,
          color: "var(--ink-3)",
        }}
      >
        <span>
          {rows.length.toLocaleString()} shown ·{" "}
          {search.trim() || levels.length < LOG_LEVELS.length
            ? searching
              ? `searching all ${historyCount.toLocaleString()} on disk…`
              : `matched from all ${historyCount.toLocaleString()} on disk${
                  searchTruncated ? ` (first ${SEARCH_LIMIT.toLocaleString()} matches)` : ""
                }${loadingOlder ? " · loading older…" : ""}`
            : `${tail.length.toLocaleString()} in memory · ${historyCount.toLocaleString()} / ${MAX_ENTRIES.toLocaleString()} on disk${
                loadingOlder ? " · loading older…" : ""
              }`}{" "}
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
  );
}

function LogRow({
  entry,
  now,
  selected,
  onSelect,
}: {
  entry: LogEntry;
  now: number;
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
      <span style={{ color: "var(--ink-3)" }}>{formatAge(entry.ts, now)}</span>
      <span style={{ color: LEVEL_COLOR[entry.level] }}>{entry.level}</span>
      <span style={ELLIPSIS}>{entry.source}</span>
      <span style={{ color: "var(--ink-3)", opacity: 0.55 }}>{entry.sha}</span>
      <span style={{ ...ELLIPSIS, color: "var(--ink-2)" }}>{deviceLabel(entry)}</span>
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
 * list looks empty. Double-tap solos the level (see soloLevel).
 */
function LevelChip({
  level,
  active,
  onToggle,
  onSolo,
}: {
  level: LogLevel;
  active: boolean;
  onToggle: () => void;
  onSolo: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      onDoubleClick={onSolo}
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
  title,
  progress,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  /** 0..1 , renders a determinate fill behind the label (filtered export). */
  progress?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        height: "100%",
        padding: "0 14px",
        background:
          progress !== undefined
            ? `linear-gradient(to right, var(--hair) ${progress * 100}%, var(--nest) ${progress * 100}%)`
            : "var(--nest)",
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
