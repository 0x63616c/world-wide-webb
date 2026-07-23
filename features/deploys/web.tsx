/**
 * Deploys tile (Track C, Wave 2 fold of DeployTile.tsx + DeployTileView.tsx).
 * Polls deploys.status (renamed from the pre-fold `github` router — see
 * api.ts) every 10s; formatting helpers are pure and re-used by the detail
 * page wiring (apps/web/src/components/tiles/detail/wiring/deploys.tsx) and
 * by the Storybook stories left under apps/web/src/components/tiles/.
 *
 * All formatting of times is done here against a ticking `now` so elapsed /
 * "ago" strings move while a deploy runs, independent of poll timing.
 */

// Type-only import back into apps/web's detail-page body, which in turn imports
// DeployCommit/DeployFailure/CommitState from this file (see fold review finding
// 1) — a genuine two-file cycle, but type-only so no runtime cycle; resolves at
// compile time via the features/tsconfig.json `@/*` -> apps/web/src/* mapping.
import type { DeployModalCommit } from "@/components/tiles/views/DeployModalPipeline";
import { Pill, PillTone, Skeleton, Stat, Tile, TileHeader, TileStatus } from "@/components/ui";
import { POLL, useNow } from "@/lib/hooks";
import { formatSha } from "@/lib/short-sha";
import type { RouterOutputs } from "@/lib/trpc";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";

type DeployStatus = RouterOutputs["deploys"]["status"];

// ── types + CommitState (moved verbatim from DeployTileView.tsx) ──────────

/** Per-commit deploy outcome, mirroring the `deploy` job conclusion. */
export const CommitState = {
  Deployed: "deployed",
  Building: "building",
  Failed: "failed",
  /** Run succeeded but the `deploy` job was skipped by path filters. */
  Skipped: "skipped",
} as const;
export type CommitState = (typeof CommitState)[keyof typeof CommitState];

export interface DeployCommit {
  sha: string;
  message: string;
  when: string;
  state: CommitState;
}

export interface DeployRun {
  jobName: string;
  stepName: string;
  elapsed: string;
}

export interface DeployFailure {
  jobName: string;
  stepName: string;
}

interface DeployTileViewBaseProps {
  status: TileStatus;
}

interface DeployTileViewLoadingProps extends DeployTileViewBaseProps {
  status: typeof TileStatus.Loading;
}

interface DeployTileViewPopulatedProps extends DeployTileViewBaseProps {
  status: typeof TileStatus.Populated;
  /** True when the GitHub token is unset , the tile says so instead of looking broken. */
  unconfigured?: boolean;
  /** Short sha the cluster was last reconciled to. */
  deployedSha: string;
  deployedWhen: string;
  commitsBehind: number;
  run: DeployRun | null;
  failure: DeployFailure | null;
  commits: DeployCommit[];
  /** Set when polling is failing (e.g. expired token) , never lie silently. */
  staleFor: string | null;
}

export type DeployTileViewProps = DeployTileViewLoadingProps | DeployTileViewPopulatedProps;

// ── pure helpers (moved verbatim from DeployTile.tsx) ──────────────────────

/** Poll gap after which the data itself is declared stale on the tile. */
export const STALE_AFTER_MS = 5 * 60 * 1000;
/** Failure streak after which the data is declared stale even if recent. */
export const STALE_AFTER_FAILURES = 3;

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
    sha: formatSha(c.sha),
    message: c.message,
    when: formatAgo(c.committedAtUtc, nowMs),
    state: c.state,
    htmlUrl: c.htmlUrl,
    filesChanged: c.changedFileCount ?? 0,
    additions: c.additions ?? 0,
    deletions: c.deletions ?? 0,
  }));
}

// ── view (moved verbatim from DeployTileView.tsx) ──────────────────────────

const FAIL_RED = "#f4635f";

const STATE_COLOR: Record<CommitState, string> = {
  deployed: "var(--acc)",
  building: "var(--amber)",
  failed: FAIL_RED,
  skipped: "var(--ink-3)",
};

function CommitDot({ state }: { state: CommitState }) {
  // The in-flight commit reuses the pulsing .dot so "something is happening" is
  // legible from across the room, not just on close inspection.
  if (state === CommitState.Building) {
    return (
      <span
        className="dot"
        style={{ background: "var(--amber)", boxShadow: "0 0 0 0 rgba(244,192,99,.5)" }}
      />
    );
  }
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: STATE_COLOR[state],
        display: "inline-block",
        flex: "0 0 auto",
      }}
    />
  );
}

function CommitRow({ commit }: { commit: DeployCommit }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 0" }}>
      <CommitDot state={commit.state} />
      <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)", flex: "0 0 auto" }}>
        {commit.sha}
      </span>
      <span
        style={{
          fontSize: 13,
          color: "var(--ink-2)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
          minWidth: 0,
        }}
      >
        {commit.message}
      </span>
      <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", flex: "0 0 auto" }}>
        {commit.when}
      </span>
    </div>
  );
}

function DeploySkeleton() {
  return (
    <Tile padding={22}>
      <TileHeader
        icon="bolt"
        title="Deploys"
        right={<Skeleton w={64} h={24} borderRadius={999} />}
      />
      <div style={{ display: "flex", gap: 26, marginTop: 2 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Skeleton w={62} h={11} borderRadius={4} />
          <Skeleton w={92} h={24} borderRadius={5} />
          <Skeleton w={52} h={11} borderRadius={4} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Skeleton w={62} h={11} borderRadius={4} />
          <Skeleton w={56} h={24} borderRadius={5} />
          <Skeleton w={78} h={11} borderRadius={4} />
        </div>
      </div>
      <div style={{ height: 1, background: "var(--hair)", margin: "14px 0 6px" }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton w="100%" h={14} borderRadius={4} />
        <Skeleton w="100%" h={14} borderRadius={4} />
        <Skeleton w="72%" h={14} borderRadius={4} />
      </div>
    </Tile>
  );
}

function headerPill(props: DeployTileViewPopulatedProps) {
  if (props.unconfigured) return <Pill>not configured</Pill>;
  if (props.staleFor) return <Pill tone={PillTone.Amber}>{`stale ${props.staleFor}`}</Pill>;
  if (props.failure) return <Pill style={{ color: FAIL_RED }}>failed</Pill>;
  if (props.run)
    return (
      <Pill tone={PillTone.Amber}>
        <span className="dot" style={{ background: "var(--amber)" }} />
        deploying
      </Pill>
    );
  if (props.commitsBehind > 0) return <Pill>{`${props.commitsBehind} behind`}</Pill>;
  return <Pill tone={PillTone.On}>up to date</Pill>;
}

export function DeployTileView(props: DeployTileViewProps) {
  if (props.status === TileStatus.Loading) return <DeploySkeleton />;

  if (props.unconfigured) {
    return (
      <Tile padding={22}>
        <TileHeader icon="bolt" title="Deploys" right={headerPill(props)} />
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--ink-3)" }}>GITHUB_ACTIONS_TOKEN not set</span>
        </div>
      </Tile>
    );
  }

  const { deployedSha, deployedWhen, run, failure, commits } = props;

  return (
    <Tile padding={22}>
      <TileHeader icon="bolt" title="Deploys" right={headerPill(props)} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <Stat label="deployed" value={deployedSha} accent sub={deployedWhen} />
        {/* Stat's flex column stretches its spans full-width, so textAlign on
            the wrapper right-aligns label, value, and sub together. */}
        <div style={{ textAlign: "right" }}>
          <Stat
            label="pipeline"
            value={
              failure ? (
                <span style={{ color: FAIL_RED }}>fail</span>
              ) : run ? (
                <span style={{ color: "var(--amber)" }}>{run.elapsed}</span>
              ) : (
                "idle"
              )
            }
            muted={!run && !failure}
            sub={
              failure
                ? `${failure.jobName} › ${failure.stepName}`
                : run
                  ? run.jobName
                  : "no runs active"
            }
          />
        </div>
      </div>
      <div style={{ height: 1, background: "var(--hair)", margin: "14px 0 6px" }} />
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {commits.slice(0, 6).map((c) => (
          <CommitRow key={c.sha} commit={c} />
        ))}
      </div>
    </Tile>
  );
}

// ── container (moved verbatim from DeployTile.tsx, trpc.github.status →
//    trpc.deploys.status) ──────────────────────────────────────────────────

export function DeployTile() {
  const tile = useTileQuery(
    trpc.deploys.status.useQuery(undefined, {
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
    sha: formatSha(c.sha),
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
      deployedSha={formatSha(data.deployedSha ?? "")}
      deployedWhen={data.deployedAtUtc ? `${formatAgo(data.deployedAtUtc, nowMs)} ago` : ""}
      commitsBehind={data.commitsBehind}
      run={run}
      failure={failure}
      commits={commits}
      staleFor={staleFor}
    />
  );
}
