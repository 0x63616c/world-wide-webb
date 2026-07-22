/**
 * Weight tile — live wiring for its two detail-page variants: "Trend"
 * (WeightPageView — range picker + chart + window stats) and "Readings"
 * (WeightReadingsView — raw list with include/exclude toggles).
 *
 * Data: trpc.weight.summary (range state lives here) + trpc.weight.readings.
 * setExcluded invalidates both on settle so a toggle reflows the chart, the
 * stats, and the tile face together. kg→lb conversion happens here — the views
 * speak lb only (same boundary rule as WeightTile).
 */

import { useState } from "react";
import type { WeightRange } from "@/components/tiles/WeightPageView";
import { WeightPageView } from "@/components/tiles/WeightPageView";
import type { WeightReadingDay, WeightReadingRow } from "@/components/tiles/WeightReadingsView";
import { WeightReadingsView } from "@/components/tiles/WeightReadingsView";
import { LB_PER_KG } from "@/components/tiles/WeightTile";
import { formatRecency } from "@/components/tiles/WeightTileView";
import { TileStatus } from "@/components/ui";
import { POLL, useNow } from "@/lib/hooks";
import type { RouterOutputs } from "@/lib/trpc";
import { trpc } from "@/lib/trpc";
import type { DetailVariant, TileDetailPageEntry } from "../types";

/** "Jun 22 – Today" for the chart's bottom-right window label. */
function windowLabelOf(daily: { day: string }[], now: Date): string | null {
  const first = daily[0];
  const lastDay = daily[daily.length - 1];
  if (!first || !lastDay) return null;
  const fmt = (day: string) =>
    // day is local YYYY-MM-DD; parse as local midnight, not UTC.
    new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  // "Today"/"Yesterday" when recent, else the short date.
  const end = formatRecency(`${lastDay.day}T00:00:00`, now);
  return `${fmt(first.day)} – ${end}`;
}

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const upper = s[mid] ?? Number.NaN;
  const lower = s[mid - 1];
  return s.length % 2 || lower === undefined ? upper : (lower + upper) / 2;
}

/**
 * Newest-first raw rows → day groups: each day carries the median of its
 * included readings and the change against the previous day's median.
 *
 * PROTOTYPE: this grouping belongs on the server, where the tRPC input carries
 * the panel's IANA timezone; grouping here uses the browser's own zone.
 */
function toReadingDays(
  readings: RouterOutputs["weight"]["readings"],
  now: Date,
): WeightReadingDay[] {
  const byDay = new Map<
    string,
    { label: string; rows: WeightReadingRow[]; includedLb: number[] }
  >();

  for (const r of readings) {
    const at = new Date(r.measuredAt);
    // Local calendar day as YYYY-MM-DD, in the browser's zone.
    const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(
      at.getDate(),
    ).padStart(2, "0")}`;
    let group = byDay.get(key);
    if (!group) {
      group = { label: formatRecency(r.measuredAt, now), rows: [], includedLb: [] };
      byDay.set(key, group);
    }
    const lb = r.weightKg * LB_PER_KG;
    const excluded = r.excludedReason != null;
    if (!excluded) group.includedLb.push(lb);
    group.rows.push({
      id: r.id,
      timeLabel: at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      lb,
      deltaLb: r.deltaKg == null ? null : r.deltaKg * LB_PER_KG,
      excluded,
      auto: r.excludedReason === "sanity_band",
    });
  }

  // readings arrive newest-first, so the map is already newest-day-first.
  const days = [...byDay.entries()].map(([key, g]) => ({
    key,
    label: g.label,
    medianLb: medianOf(g.includedLb),
    dayDeltaLb: null as number | null,
    readings: g.rows,
  }));
  // Each day compares against the next entry, which is the older day.
  return days.map((d, i) => {
    const older = days[i + 1];
    const comparable = older && Number.isFinite(d.medianLb) && Number.isFinite(older.medianLb);
    return { ...d, dayDeltaLb: comparable ? d.medianLb - older.medianLb : null };
  });
}

function useWeightVariants(): { variants: DetailVariant[]; loading: boolean } {
  const [range, setRange] = useState<WeightRange>("30d");
  const now = useNow();

  const utils = trpc.useUtils();
  const summaryQuery = trpc.weight.summary.useQuery({ range }, { refetchInterval: POLL.weight });
  const readingsQuery = trpc.weight.readings.useQuery(undefined, {
    refetchInterval: POLL.weight,
  });
  const invalidate = () => {
    void utils.weight.summary.invalidate();
    void utils.weight.readings.invalidate();
  };
  const setExcludedMutation = trpc.weight.setExcluded.useMutation({ onSettled: invalidate });

  const summary = summaryQuery.data;
  const readings = readingsQuery.data;

  const variants: DetailVariant[] = [
    {
      slug: "trend",
      label: "Trend",
      render: () =>
        summary ? (
          <WeightPageView
            status={TileStatus.Populated}
            range={range}
            onRangeChange={setRange}
            lb={summary.latestKg * LB_PER_KG}
            daily={summary.daily.map((d) => ({ day: d.day, lb: d.kg * LB_PER_KG }))}
            low={summary.low * LB_PER_KG}
            high={summary.high * LB_PER_KG}
            average={summary.average * LB_PER_KG}
            change={summary.change * LB_PER_KG}
            windowLabel={windowLabelOf(summary.daily, now) ?? undefined}
          />
        ) : (
          // Null summary = day one (no included readings yet), not an error.
          <WeightPageView
            status={summaryQuery.isPending ? TileStatus.Loading : TileStatus.Populated}
            range={range}
            onRangeChange={setRange}
          />
        ),
    },
    {
      slug: "readings",
      label: "Readings",
      render: () => (
        <WeightReadingsView
          status={readings ? TileStatus.Populated : TileStatus.Loading}
          days={readings ? toReadingDays(readings, now) : undefined}
          onToggle={(id, excluded) => setExcludedMutation.mutate({ id, excluded })}
          // onDelete is deliberately absent until the tombstone column exists:
          // ingest re-inserts any hard-deleted row on its next poll.
        />
      ),
    },
  ];

  // Variants render their own skeletons; the page itself is never "loading",
  // so day one still shows the Trend/Readings switcher instead of a bare shim.
  return { variants, loading: false };
}

export const weightDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_weight",
  title: "Weight",
  defaultSlug: "trend",
  useVariants: useWeightVariants,
};
