import { Pill, PillTone, Skeleton, Tile, TileHeader, TileStatus } from "@/components/ui";

/**
 * Layout direction under evaluation (see
 * docs/superpowers/specs/2026-07-18-github-deploy-tile-design.md). Three
 * candidates render from one data shape so the choice is about layout, not
 * about which fields each mock happens to show. The losing variants are deleted
 * once a direction is picked.
 */
export const DeployLayout = {
  /** One large verdict line; commit feed is secondary context. */
  Status: "status",
  /** In-flight run gets the top slot with live step; history below with diff stats. */
  Rail: "rail",
  /** Failure detail (log tail) promoted onto the tile face. */
  Failure: "failure",
} as const;
export type DeployLayout = (typeof DeployLayout)[keyof typeof DeployLayout];

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
  additions: number;
  deletions: number;
}

export interface DeployRun {
  jobName: string;
  stepName: string;
  elapsed: string;
  /** 0..1 , fraction of jobs completed in the in-flight run. */
  progress: number;
}

export interface DeployFailure {
  jobName: string;
  stepName: string;
  logTail: string;
}

interface DeployTileViewBaseProps {
  status: TileStatus;
  layout?: DeployLayout;
}

interface DeployTileViewLoadingProps extends DeployTileViewBaseProps {
  status: typeof TileStatus.Loading;
}

interface DeployTileViewPopulatedProps extends DeployTileViewBaseProps {
  status: typeof TileStatus.Populated;
  /** Short sha the cluster was last reconciled to. */
  deployedSha: string;
  deployedWhen: string;
  /** Short sha of the bundle this browser tab is running. */
  panelSha: string;
  commitsBehind: number;
  run: DeployRun | null;
  failure: DeployFailure | null;
  commits: DeployCommit[];
  /** Set when polling is failing or the token has expired , never lie silently. */
  staleFor: string | null;
}

export type DeployTileViewProps = DeployTileViewLoadingProps | DeployTileViewPopulatedProps;

const STATE_COLOR: Record<CommitState, string> = {
  deployed: "var(--acc)",
  building: "var(--amber)",
  failed: "#f4635f",
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

function CommitRow({ commit, showDiff }: { commit: DeployCommit; showDiff?: boolean }) {
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
      {showDiff ? (
        <span className="mono" style={{ fontSize: 11.5, flex: "0 0 auto" }}>
          <span style={{ color: "var(--teal)" }}>{`+${commit.additions}`}</span>{" "}
          <span style={{ color: "var(--ink-3)" }}>{`-${commit.deletions}`}</span>
        </span>
      ) : (
        <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", flex: "0 0 auto" }}>
          {commit.when}
        </span>
      )}
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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
        <Skeleton w={168} h={30} borderRadius={6} />
        <Skeleton w={120} h={13} borderRadius={4} />
        <div style={{ height: 1, background: "var(--hair)", margin: "4px 0" }} />
        <Skeleton w="100%" h={14} borderRadius={4} />
        <Skeleton w="100%" h={14} borderRadius={4} />
        <Skeleton w="100%" h={14} borderRadius={4} />
      </div>
    </Tile>
  );
}

function headerPill(props: DeployTileViewPopulatedProps) {
  if (props.staleFor) return <Pill tone={PillTone.Amber}>{`stale ${props.staleFor}`}</Pill>;
  if (props.failure) return <Pill style={{ color: "#f4635f" }}>failed</Pill>;
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

/** Layout A , one large verdict line, feed as supporting context. */
function StatusLayout(props: DeployTileViewPopulatedProps) {
  const { deployedSha, deployedWhen, panelSha, commitsBehind, failure, run, commits } = props;

  const verdict = failure
    ? { text: `${failure.jobName} failed`, color: "#f4635f" }
    : run
      ? { text: "Deploying", color: "var(--amber)" }
      : commitsBehind > 0
        ? { text: `${commitsBehind} behind`, color: "var(--ink)" }
        : { text: "Up to date", color: "var(--acc)" };

  return (
    <>
      <div
        style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.025em", color: verdict.color }}
      >
        {verdict.text}
      </div>
      <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>
        {`${deployedSha} deployed ${deployedWhen}`}
        {panelSha === deployedSha ? "" : ` · panel ${panelSha}`}
      </div>
      <div style={{ height: 1, background: "var(--hair)", margin: "12px 0 4px" }} />
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {commits.slice(0, 4).map((c) => (
          <CommitRow key={c.sha} commit={c} />
        ))}
      </div>
    </>
  );
}

/** Layout B , in-flight run on top with live step, history below with diff stats. */
function RailLayout(props: DeployTileViewPopulatedProps) {
  const { run, commits, commitsBehind, deployedSha } = props;
  const head = commits[0];

  return (
    <>
      {run && head ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {head.sha}
            </span>
            <span style={{ fontSize: 13, color: "var(--amber)", fontWeight: 500 }}>
              {`${run.jobName} · ${run.stepName}`}
            </span>
            <span
              className="mono"
              style={{ fontSize: 12, color: "var(--ink-3)", marginLeft: "auto" }}
            >
              {run.elapsed}
            </span>
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              marginTop: 3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {head.message}
          </div>
          <div
            style={{
              height: 4,
              background: "var(--nest)",
              borderRadius: 999,
              overflow: "hidden",
              marginTop: 9,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.round(run.progress * 100)}%`,
                background: "var(--amber)",
                borderRadius: 999,
              }}
            />
          </div>
        </div>
      ) : null}
      <div style={{ height: 1, background: "var(--hair)", margin: "2px 0 4px" }} />
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {commits.slice(run ? 1 : 0, run ? 5 : 4).map((c) => (
          <CommitRow key={c.sha} commit={c} showDiff />
        ))}
      </div>
      <div
        className="cap"
        style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}
      >
        <span>{`deployed ${deployedSha}`}</span>
        <span>{commitsBehind > 0 ? `panel ${commitsBehind} behind` : "panel current"}</span>
      </div>
    </>
  );
}

/** Layout C , failure detail promoted onto the tile face; no tap required. */
function FailureLayout(props: DeployTileViewPopulatedProps) {
  const { failure, commits, deployedSha, deployedWhen } = props;

  if (!failure) return <StatusLayout {...props} />;

  return (
    <>
      <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "#f4635f" }}>
        {`${failure.jobName} › ${failure.stepName}`}
      </div>
      <div
        className="mono"
        style={{
          marginTop: 10,
          background: "var(--tile-2)",
          border: "1px solid var(--hair)",
          borderRadius: 12,
          padding: "9px 11px",
          fontSize: 11,
          lineHeight: 1.5,
          color: "#f4635f",
          whiteSpace: "pre",
          overflow: "hidden",
        }}
      >
        {failure.logTail}
      </div>
      <div style={{ height: 1, background: "var(--hair)", margin: "12px 0 4px" }} />
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {commits.slice(0, 2).map((c) => (
          <CommitRow key={c.sha} commit={c} />
        ))}
      </div>
      <div
        className="cap"
        style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}
      >
        <span>{`running ${deployedSha}`}</span>
        <span>{`last good ${deployedWhen}`}</span>
      </div>
    </>
  );
}

export function DeployTileView(props: DeployTileViewProps) {
  if (props.status === TileStatus.Loading) return <DeploySkeleton />;

  const layout = props.layout ?? DeployLayout.Status;

  return (
    <Tile padding={22}>
      <TileHeader icon="bolt" title="Deploys" right={headerPill(props)} />
      {layout === DeployLayout.Rail ? (
        <RailLayout {...props} />
      ) : layout === DeployLayout.Failure ? (
        <FailureLayout {...props} />
      ) : (
        <StatusLayout {...props} />
      )}
    </Tile>
  );
}
