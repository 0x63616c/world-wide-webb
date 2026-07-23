/**
 * Weight tile — live wiring for its two detail-page variants: "Trend"
 * (WeightPageView — range picker + chart + window stats) and "Readings"
 * (WeightReadingsView — day groups with per-reading actions).
 *
 * This layer is the presentation boundary: it states the panel's timezone on
 * every query (the api never infers one), and converts kg→lb (the views speak
 * lb only). Day grouping and all statistics happen server-side.
 */

import { formatRecency, LB_PER_KG } from "@features/weight/web";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WeightRange } from "@/components/tiles/WeightPageView";
import { WeightPageView } from "@/components/tiles/WeightPageView";
import type { WeightReadingDay } from "@/components/tiles/WeightReadingsView";
import { WeightReadingsView } from "@/components/tiles/WeightReadingsView";
import { TileStatus } from "@/components/ui";
import { POLL, useNow } from "@/lib/hooks";
import type { RouterOutputs } from "@/lib/trpc";
import { trpc } from "@/lib/trpc";
import type { DetailVariant, TileDetailPageEntry } from "../types";

/** The panel's own IANA zone, e.g. "America/Los_Angeles". */
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** "Jun 22 – Today" for the chart's bottom-right window label. */
function windowLabelOf(daily: { day: string }[], now: Date): string | null {
  const first = daily[0];
  const lastDay = daily[daily.length - 1];
  if (!first || !lastDay) return null;
  const fmt = (day: string) =>
    // day is a local YYYY-MM-DD; parse as local midnight, not UTC.
    new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const end = formatRecency(`${lastDay.day}T00:00:00`, now);
  return `${fmt(first.day)} – ${end}`;
}

function toViewDays(pages: RouterOutputs["weight"]["days"][], now: Date): WeightReadingDay[] {
  const all = pages.flatMap((page) =>
    page.days.map((d) => ({
      key: d.day,
      label: formatRecency(`${d.day}T00:00:00`, now),
      medianLb: d.medianKg == null ? null : d.medianKg * LB_PER_KG,
      dayDeltaLb: d.dayDeltaKg == null ? null : d.dayDeltaKg * LB_PER_KG,
      readings: d.readings.map((r) => ({
        id: r.id,
        timeLabel: new Date(r.measuredAt).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
        lb: r.weightKg * LB_PER_KG,
        deltaLb: r.deltaKg == null ? null : r.deltaKg * LB_PER_KG,
        excluded: r.excludedReason != null,
        auto: r.excludedReason === "sanity_band",
      })),
    })),
  );
  // A weigh-in landing on a new day shifts every page's cursor by one day, so
  // a day can appear at the tail of one page AND the head of the next once a
  // stale page refetches with its original (now-shifted) params. Keep the
  // first occurrence — pages are ordered newest-first, so that's the copy
  // with the most complete reading list.
  const seen = new Set<string>();
  return all.filter((d) => {
    if (seen.has(d.key)) return false;
    seen.add(d.key);
    return true;
  });
}

function useWeightVariants(): { variants: DetailVariant[]; loading: boolean } {
  const [range, setRange] = useState<WeightRange>("30d");
  const now = useNow();

  const utils = trpc.useUtils();
  const summaryQuery = trpc.weight.summary.useQuery(
    { range, tz: TZ },
    { refetchInterval: POLL.weight },
  );
  const daysQuery = trpc.weight.days.useInfiniteQuery(
    { tz: TZ },
    {
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      // No polling: pages are keyed by absolute day-string cursors, frozen at
      // first fetch. A poll refetches every page with those stale params,
      // which silently drops or duplicates a day whenever a weigh-in shifts
      // which day falls on a page boundary. The mutations below already
      // invalidate on their own, which is the only time this list can change.
    },
  );
  const invalidate = () => {
    void utils.weight.summary.invalidate();
    void utils.weight.days.invalidate();
  };
  const setExcludedMutation = trpc.weight.setExcluded.useMutation({ onSettled: invalidate });
  const deleteMutation = trpc.weight.delete.useMutation({ onSettled: invalidate });

  // The Readings list can't poll (its day-string cursors are frozen at first
  // fetch — a timed refetch would drop/dupe a boundary day). Instead, piggyback
  // on the summary poll: when its freshness token advances, a new reading has
  // landed, so invalidate the list once. The first observed value only seeds
  // the ref (the list's own initial fetch is already current).
  const lastSeenAt = useRef<string | null>(null);
  const latestMeasuredAt = summaryQuery.data?.latestMeasuredAt ?? null;
  useEffect(() => {
    if (latestMeasuredAt === null) return;
    if (lastSeenAt.current === null) {
      lastSeenAt.current = latestMeasuredAt;
      return;
    }
    if (lastSeenAt.current !== latestMeasuredAt) {
      lastSeenAt.current = latestMeasuredAt;
      void utils.weight.days.invalidate();
    }
  }, [latestMeasuredAt, utils]);

  const summary = summaryQuery.data;
  const pages = daysQuery.data?.pages;

  // Stable identity: the view observes this in an effect, so a function whose
  // identity changed every time isFetchingNextPage flipped (the old
  // dependency array) tore down and recreated the IntersectionObserver on
  // every fetch — and a fresh observer re-fires immediately for a sentinel
  // that's still on screen, chain-fetching every page back to back. Read the
  // latest query state from refs instead of closing over it.
  const hasNextPageRef = useRef(daysQuery.hasNextPage);
  hasNextPageRef.current = daysQuery.hasNextPage;
  const isFetchingNextPageRef = useRef(daysQuery.isFetchingNextPage);
  isFetchingNextPageRef.current = daysQuery.isFetchingNextPage;
  const fetchNextPageRef = useRef(daysQuery.fetchNextPage);
  fetchNextPageRef.current = daysQuery.fetchNextPage;
  const loadMore = useCallback(() => {
    if (hasNextPageRef.current && !isFetchingNextPageRef.current) void fetchNextPageRef.current();
  }, []);

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
          status={pages ? TileStatus.Populated : TileStatus.Loading}
          days={pages ? toViewDays(pages, now) : undefined}
          onToggle={(id, excluded) => setExcludedMutation.mutate({ id, excluded })}
          onDelete={(id) => deleteMutation.mutate({ id })}
          onLoadMore={daysQuery.hasNextPage ? loadMore : undefined}
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
