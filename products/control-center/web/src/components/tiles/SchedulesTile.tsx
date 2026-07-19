/**
 * SchedulesTile , thin container for the Schedules tile face.
 *
 * Data: trpc.schedules.list + schedules.nextRuns. Tapping the tile opens the
 * full-page schedules manager via the board's tile-detail registry (wired in
 * detail/wiring/schedules.tsx, which owns the CRUD mutations). Presentation
 * lives in SchedulesTileView + ExpandedSchedulesModalView.
 */

import { TileStatus } from "@/components/ui";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import type { ScheduleItem } from "./modals/ExpandedSchedulesModalView";
import type { SchedulesRow } from "./SchedulesTileView";
import { SchedulesTileView } from "./SchedulesTileView";
import { daysSummary, displayScene, triggerTimeLabel } from "./schedule-scene";

/** Format an ISO timestamp as local "H:MM" for the tile / list labels. */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function SchedulesTile() {
  const list = trpc.schedules.list.useQuery(undefined, { refetchInterval: POLL.schedules });
  const nextRuns = trpc.schedules.nextRuns.useQuery(undefined, { refetchInterval: POLL.schedules });
  const tile = useTileQuery(list);

  if (tile.status !== TileStatus.Populated) return <SchedulesTileView status={tile.status} />;

  const schedules = tile.data as ScheduleItem[];
  const nextIsoById = new Map((nextRuns.data ?? []).map((r) => [r.id, r.nextIso]));
  const nextLabelById: Record<string, string | null> = {};
  for (const s of schedules) {
    const iso = nextIsoById.get(s.id) ?? null;
    nextLabelById[s.id] = iso ? hhmm(iso) : null;
  }

  const enabled = schedules.filter((s) => s.enabled);
  const enabledCount = enabled.length;

  // Active schedules ordered soonest-first (those with no upcoming fire last), so
  // the tile shows the two that fire next and the footer spotlights the first.
  const fireTime = (s: ScheduleItem): number => {
    const iso = nextIsoById.get(s.id);
    return iso ? new Date(iso).getTime() : Infinity;
  };
  const ordered = [...enabled].sort((a, b) => fireTime(a) - fireTime(b));

  const rows: SchedulesRow[] = ordered.slice(0, 2).map((s) => ({
    id: s.id,
    name: s.name,
    days: daysSummary(s.days),
    time: triggerTimeLabel(s.trigger, nextLabelById[s.id] ?? null),
    scene: displayScene(s.action),
  }));

  // Next upcoming across enabled schedules: the earliest future nextIso.
  const now = Date.now();
  let nextName = "";
  let nextTime = "";
  let soonest = Infinity;
  for (const s of enabled) {
    const iso = nextIsoById.get(s.id);
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (t >= now && t < soonest) {
      soonest = t;
      nextName = s.name;
      nextTime = hhmm(iso);
    }
  }
  const next = soonest === Infinity ? null : { name: nextName, time: nextTime };

  return <SchedulesTileView status={TileStatus.Populated} data={{ enabledCount, rows, next }} />;
}
