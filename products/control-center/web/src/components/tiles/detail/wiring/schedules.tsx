/**
 * Schedules tile , live wiring for its single detail-page variant.
 *
 * Data: trpc.schedules.list + schedules.nextRuns + schedules.lights. Mutations
 * (create/update/remove/setEnabled) invalidate the list + nextRuns on settle so
 * the tile face and this page always reflect the authoritative rows. The write
 * path (schedule CRUD) lives HERE, not in the tile , only the manager page
 * mutates.
 */

import type {
  ScheduleInput,
  ScheduleItem,
} from "@/components/tiles/modals/ExpandedSchedulesModalView";
import { ExpandedSchedulesModalView } from "@/components/tiles/modals/ExpandedSchedulesModalView";
import { hhmm } from "@/components/tiles/SchedulesTile";
import { displayScene } from "@/components/tiles/schedule-scene";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import type { DetailVariant, TileDetailPageEntry } from "../types";

function useSchedulesVariants(): { variants: DetailVariant[]; loading: boolean } {
  const utils = trpc.useUtils();
  const list = trpc.schedules.list.useQuery(undefined, { refetchInterval: POLL.schedules });
  const nextRuns = trpc.schedules.nextRuns.useQuery(undefined, { refetchInterval: POLL.schedules });
  const lights = trpc.schedules.lights.useQuery(undefined);

  const invalidate = () => {
    utils.schedules.list.invalidate();
    utils.schedules.nextRuns.invalidate();
  };
  const createMutation = trpc.schedules.create.useMutation({ onSettled: invalidate });
  const updateMutation = trpc.schedules.update.useMutation({ onSettled: invalidate });
  const removeMutation = trpc.schedules.remove.useMutation({ onSettled: invalidate });
  const enableMutation = trpc.schedules.setEnabled.useMutation({ onSettled: invalidate });

  if (!list.data) return { variants: [], loading: true };

  const schedules = list.data as ScheduleItem[];
  const nextIsoById = new Map((nextRuns.data ?? []).map((r) => [r.id, r.nextIso]));
  const nextLabelById: Record<string, string | null> = {};
  for (const s of schedules) {
    const iso = nextIsoById.get(s.id) ?? null;
    nextLabelById[s.id] = iso ? hhmm(iso) : null;
  }

  // Next upcoming across enabled schedules: the earliest future nextIso,
  // spotlighted in the "Up next" card with its scene chip.
  const now = Date.now();
  let nextUp: { name: string; time: string; scene: ReturnType<typeof displayScene> } | null = null;
  let soonest = Infinity;
  for (const s of schedules.filter((x) => x.enabled)) {
    const iso = nextIsoById.get(s.id);
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (t >= now && t < soonest) {
      soonest = t;
      nextUp = { name: s.name, time: hhmm(iso), scene: displayScene(s.action) };
    }
  }

  const variants: DetailVariant[] = [
    {
      slug: "detail",
      label: "Schedules",
      render: () => (
        <ExpandedSchedulesModalView
          schedules={schedules}
          nextLabelById={nextLabelById}
          nextUp={nextUp}
          lights={lights.data ?? []}
          onCreate={(input: ScheduleInput) => createMutation.mutate(input)}
          onUpdate={(id: string, input: ScheduleInput) =>
            updateMutation.mutate({ id, patch: input })
          }
          onDelete={(id: string) => removeMutation.mutate({ id })}
          onToggle={(id: string, en: boolean) => enableMutation.mutate({ id, enabled: en })}
        />
      ),
    },
  ];

  return { variants, loading: false };
}

export const schedulesDetailEntry: TileDetailPageEntry = {
  kind: "page",
  tileId: "tile_sched",
  title: "Schedules",
  defaultSlug: "detail",
  useVariants: useSchedulesVariants,
};
