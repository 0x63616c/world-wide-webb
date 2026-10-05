import { trpc } from "@/lib/trpc";

export function useAlarms() {
  return trpc.alarms.list.useQuery(undefined, {
    refetchInterval: 1_000,
    refetchIntervalInBackground: true,
    retry: 1,
  });
}
