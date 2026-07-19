/**
 * DeployTile , container for the Deploys tile (spec
 * 2026-07-18-github-deploy-tile-design). Polls github.status every 10s (fast
 * enough that "deploying" appears within one worker hot tick) and maps the
 * wire status onto the locked DeployTileView. Tapping the tile opens the
 * full-page deploy detail via the board's tile-detail registry (wired in
 * detail/wiring/deploys.tsx, which reuses this file's pure helpers).
 *
 * All formatting of times is done here against a ticking `now` so elapsed /
 * "ago" strings move while a deploy runs, independent of poll timing.
 */

import { TileStatus } from "@/components/ui";
import { POLL, useNow } from "@/lib/hooks";
import type { RouterOutputs } from "@/lib/trpc";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import type { DeployCommit } from "./DeployTileView";
import { DeployTileView } from "./DeployTileView";
import type { DeployModalCommit } from "./modals/DeployModalPipeline";

type DeployStatus = RouterOutputs["github"]["status"];

/** Poll gap after which the data itself is declared stale on the tile. */
export const STALE_AFTER_MS = 5 * 60 * 1000;
/** Failure streak after which the data is declared stale even if recent. */
export const STALE_AFTER_FAILURES = 3;

const SHORT_SHA_LEN = 9;

/** Compact age: 42s, 14m, 3h, 2d. */
export function formatAgo(iso: string, nowMs: number): string {
  const ageMs = Math.max(0, nowMs - new Date(iso).getTime());
  const s = Math.floor(ageMs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Run-timer format: 42s below a minute, then 2m14s. */
export function formatElapsed(startedAtIso: string, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - new Date(startedAtIso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

/** Stale verdict + age string; null while polling is healthy. */
export function staleForOf(status: DeployStatus, nowMs: number): string | null {
  if (!status.lastPolledAtUtc) return null;
  const age = nowMs - new Date(status.lastPolledAtUtc).getTime();
  if (age < STALE_AFTER_MS && status.consecutiveFailures < STALE_AFTER_FAILURES) return null;
  return formatAgo(status.lastPolledAtUtc, nowMs);
}

/** The detail page's enriched commit rows (author + diffstat on top of the tile row). */
export function toModalCommits(status: DeployStatus, nowMs: number): DeployModalCommit[] {
  return status.commits.map((c) => ({
    sha: c.sha.slice(0, SHORT_SHA_LEN),
    message: c.message,
    when: formatAgo(c.committedAtUtc, nowMs),
    state: c.state,
    author: c.author,
    filesChanged: c.changedFileCount ?? 0,
    additions: c.additions ?? 0,
    deletions: c.deletions ?? 0,
  }));
}

export function DeployTile() {
  const tile = useTileQuery(
    trpc.github.status.useQuery(undefined, {
      refetchInterval: POLL.deploy,
    }),
  );
  const now = useNow();

  // Loading also covers "errored with nothing cached" (the tile has no distinct
  // error face) and "configured but the worker has not completed a poll yet" (no
  // deployed pointer to render): skeleton, never invented data.
  if (tile.status !== TileStatus.Populated || (tile.data.configured && !tile.data.deployedSha)) {
    return <DeployTileView status={TileStatus.Loading} />;
  }

  const data = tile.data;
  const nowMs = now.getTime();

  if (!data.configured) {
    return (
      <DeployTileView
        status={TileStatus.Populated}
        unconfigured
        deployedSha=""
        deployedWhen=""
        commitsBehind={0}
        run={null}
        failure={null}
        commits={[]}
        staleFor={null}
      />
    );
  }

  const commits: DeployCommit[] = data.commits.map((c) => ({
    sha: c.sha.slice(0, SHORT_SHA_LEN),
    message: c.message,
    when: formatAgo(c.committedAtUtc, nowMs),
    state: c.state,
  }));

  const run = data.run
    ? {
        jobName: data.run.jobName,
        stepName: data.run.stepName,
        elapsed: formatElapsed(data.run.startedAtUtc, nowMs),
      }
    : null;

  const failure = data.failure
    ? { jobName: data.failure.jobName, stepName: data.failure.stepName }
    : null;

  const staleFor = staleForOf(data, nowMs);

  return (
    <DeployTileView
      status={TileStatus.Populated}
      deployedSha={(data.deployedSha ?? "").slice(0, SHORT_SHA_LEN)}
      deployedWhen={data.deployedAtUtc ? `${formatAgo(data.deployedAtUtc, nowMs)} ago` : ""}
      commitsBehind={data.commitsBehind}
      run={run}
      failure={failure}
      commits={commits}
      staleFor={staleFor}
    />
  );
}
