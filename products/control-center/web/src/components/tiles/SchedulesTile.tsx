/**
 * SchedulesTile , thin container for the Schedules tile.
 *
 * Data: trpc.schedules.list + schedules.nextRuns + schedules.lights. Mutations
 * (create/update/remove/setEnabled) invalidate the list + nextRuns on settle so
 * the tile + modal always reflect the authoritative rows. Presentation lives in
 * SchedulesTileView + ExpandedSchedulesModalView.
 */

import { useState } from "react";
import { TileStatus } from "@/components/ui";
import { trpc } from "@/lib/trpc";
import type { ScheduleInput, ScheduleItem } from "./modals/ExpandedSchedulesModalView";
import { ExpandedSchedulesModalView } from "./modals/ExpandedSchedulesModalView";
import type { SchedulesRow } from "./SchedulesTileView";
import { SchedulesTileView } from "./SchedulesTileView";
import { type DisplayScene, daysSummary, displayScene, triggerTimeLabel } from "./schedule-scene";

/** Format an ISO timestamp as local "H:MM" for the tile / list labels. */
function hhmm(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function SchedulesTile() {
  const utils = trpc.useUtils();
  const [modalOpen, setModalOpen] = useState(false);

  const list = trpc.schedules.list.useQuery(undefined, { refetchInterval: 30_000 });
  const nextRuns = trpc.schedules.nextRuns.useQuery(undefined, { refetchInterval: 30_000 });
  const lights = trpc.schedules.lights.useQuery(undefined);

  const invalidate = () => {
    utils.schedules.list.invalidate();
    utils.schedules.nextRuns.invalidate();
  };
  const createMutation = trpc.schedules.create.useMutation({ onSettled: invalidate });
  const updateMutation = trpc.schedules.update.useMutation({ onSettled: invalidate });
  const removeMutation = trpc.schedules.remove.useMutation({ onSettled: invalidate });
  const enableMutation = trpc.schedules.setEnabled.useMutation({ onSettled: invalidate });

  if (!list.data) return <SchedulesTileView status={TileStatus.Loading} />;

  const schedules = list.data as ScheduleItem[];
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
  let nextScene: DisplayScene = "off";
  let soonest = Infinity;
  for (const s of enabled) {
    const iso = nextIsoById.get(s.id);
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (t >= now && t < soonest) {
      soonest = t;
      nextName = s.name;
      nextTime = hhmm(iso);
      nextScene = displayScene(s.action);
    }
  }
  const next = soonest === Infinity ? null : { name: nextName, time: nextTime };
  // Richer "up next" spotlight for the modal (adds the scene chip).
  const nextUp = soonest === Infinity ? null : { name: nextName, time: nextTime, scene: nextScene };

  return (
    <>
      <SchedulesTileView
        status={TileStatus.Populated}
        data={{ enabledCount, rows, next }}
        onOpen={() => setModalOpen(true)}
      />
      <ExpandedSchedulesModalView
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        schedules={schedules}
        nextLabelById={nextLabelById}
        nextUp={nextUp}
        lights={lights.data ?? []}
        onCreate={(input: ScheduleInput) => createMutation.mutate(input)}
        onUpdate={(id: string, input: ScheduleInput) => updateMutation.mutate({ id, patch: input })}
        onDelete={(id: string) => removeMutation.mutate({ id })}
        onToggle={(id: string, en: boolean) => enableMutation.mutate({ id, enabled: en })}
      />
    </>
  );
}
