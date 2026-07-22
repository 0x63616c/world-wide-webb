import { Pill, PillTone, Skeleton, Stat, Tile, TileHeader, TileStatus } from "@/components/ui";

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
