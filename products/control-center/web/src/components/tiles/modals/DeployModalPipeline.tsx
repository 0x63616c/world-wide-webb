/**
 * DeployModalPipeline , deploy/pipeline detail modal for the Deploys tile.
 *
 * WHY this layout: the tile face answers "what is live and is anything
 * happening" with two stats and a 6-row feed; this modal answers the follow-up
 * questions. A status strip mirrors the tile's deployed/pipeline pair so
 * context carries over. When a run failed, the log tail is promoted directly
 * under the strip , the error text is the single most useful thing on a
 * failure, so it outranks history. Below, the commit history gains what the
 * tile row had no room for: author, per-commit diffstat, and an explicit
 * per-commit deploy state chip (deployed / building / failed / no deploy).
 *
 * PURE view: all data arrives via props , no trpc/hooks. Composes trivially in
 * Storybook and component tests. Modal width 880 (wide , commit messages and
 * log lines want the room), scrollbar visible since history genuinely scrolls.
 */

import { Modal, Pill, PillTone, Stat } from "@/components/ui";
import type { DeployCommit, DeployFailure, DeployRun } from "../DeployTileView";
import { CommitState } from "../DeployTileView";

// ─── types ────────────────────────────────────────────────────────────────────

/** A tile commit enriched with the detail only the modal shows. */
export interface DeployModalCommit extends DeployCommit {
  author: string;
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface DeployModalPipelineProps {
  open: boolean;
  onClose: () => void;
  deployedSha: string;
  deployedWhen: string;
  run: DeployRun | null;
  /** Failure detail; logTail is the stored last-4KB of the failed step's log. */
  failure: (DeployFailure & { logTail: string }) | null;
  commits: DeployModalCommit[];
  staleFor: string | null;
}

// ─── internals ────────────────────────────────────────────────────────────────

const FAIL_RED = "#f4635f";

const STATE_LABEL: Record<CommitState, string> = {
  deployed: "deployed",
  building: "building",
  failed: "failed",
  skipped: "no deploy",
};

function stateChip(state: CommitState) {
  if (state === CommitState.Building) return <Pill tone={PillTone.Amber}>building</Pill>;
  if (state === CommitState.Failed) return <Pill style={{ color: FAIL_RED }}>failed</Pill>;
  if (state === CommitState.Deployed) return <Pill tone={PillTone.On}>deployed</Pill>;
  return <Pill>{STATE_LABEL[state]}</Pill>;
}

function CommitDetailRow({ commit }: { commit: DeployModalCommit }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px solid var(--hair)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            color: commit.state === CommitState.Failed ? FAIL_RED : "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {commit.message}
        </div>
        <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 3 }}>
          {`${commit.sha} · ${commit.author} · ${commit.when} ago`}
        </div>
      </div>
      <span className="mono" style={{ fontSize: 12, flex: "0 0 auto", color: "var(--ink-3)" }}>
        {`${commit.filesChanged}f `}
        <span style={{ color: "var(--teal)" }}>{`+${commit.additions}`}</span>{" "}
        <span style={{ color: "var(--ink-2)" }}>{`-${commit.deletions}`}</span>
      </span>
      <span style={{ flex: "0 0 auto" }}>{stateChip(commit.state)}</span>
    </div>
  );
}

// ─── component ────────────────────────────────────────────────────────────────

export function DeployModalPipeline({
  open,
  onClose,
  deployedSha,
  deployedWhen,
  run,
  failure,
  commits,
  staleFor,
}: DeployModalPipelineProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Deploys"
      width={880}
      maxHeight={880}
      scrollbar="visible"
    >
      {/* status strip , mirrors the tile face so context carries over */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 40 }}>
        <Stat label="deployed" value={deployedSha} accent sub={`${deployedWhen} · homelab`} />
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
                ? `${run.jobName} › ${run.stepName}`
                : "no runs active"
          }
        />
        {staleFor && (
          <div style={{ marginLeft: "auto" }}>
            <Pill tone={PillTone.Amber}>{`data stale ${staleFor}`}</Pill>
          </div>
        )}
      </div>

      {/* failure log tail , the most useful thing on a failure, so it outranks history */}
      {failure && (
        <div
          className="mono"
          style={{
            marginTop: 16,
            background: "var(--nest)",
            border: "1px solid var(--hair-2)",
            borderRadius: 12,
            padding: "12px 14px",
            fontSize: 12,
            lineHeight: 1.6,
            color: FAIL_RED,
            whiteSpace: "pre-wrap",
            maxHeight: 220,
            overflow: "hidden",
          }}
        >
          {failure.logTail}
        </div>
      )}

      {/* commit history with the detail the tile has no room for */}
      <div className="cap" style={{ marginTop: 22, marginBottom: 2 }}>
        recent commits · main
      </div>
      <div>
        {commits.map((c) => (
          <CommitDetailRow key={c.sha} commit={c} />
        ))}
      </div>
    </Modal>
  );
}
