import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { createElement } from "react";
import { tilePixelSize } from "@/lib/grid-constants";
import { defineTileMeta } from "./__stories__/factory";
import { type DeployCommit, DeployLayout, DeployTileView } from "./DeployTileView";

// The tile is not in TILE_REGISTRY yet (its container and router don't exist),
// so the global BoardDecorator can't derive its footprint. Size it here to the
// proposed 4x3 placement so these stories render at true production size.
const TILE_COLS = 4;
const TILE_ROWS = 3;

const TileSizeDecorator: Decorator = (Story) => {
  const { width, height } = tilePixelSize(TILE_COLS, TILE_ROWS);
  return createElement(
    "div",
    {
      className: "e-root",
      style: { width, height, display: "flex", flexDirection: "column", background: "var(--bg)" },
    },
    createElement(Story),
  );
};

// Title and tags are written literally, NOT spread from defineTileMeta: the CSF
// indexer only reads statically-analyzable fields, so a factory spread silently
// yields a path-derived title and drops the autodocs tag (the same hazard
// factory.ts documents for modal metas). argTypes still come from the factory.
const meta = {
  title: "Tiles/DeployTileView",
  component: DeployTileView,
  tags: ["autodocs"],
  argTypes: defineTileMeta("DeployTileView", DeployTileView).argTypes,
  parameters: { layout: "padded" },
  decorators: [TileSizeDecorator],
} satisfies Meta<typeof DeployTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

// Real commits from this repo , no invented history.
const COMMITS: DeployCommit[] = [
  {
    sha: "ea8aadd",
    message: "docs: design for GitHub/deploy status tile",
    when: "14m",
    state: "deployed",
    additions: 286,
    deletions: 0,
  },
  {
    sha: "6d5d276",
    message: "chore(ci): refresh coverage + loc badges",
    when: "1h",
    state: "skipped",
    additions: 2,
    deletions: 2,
  },
  {
    sha: "676314c",
    message: "fix(infra): recreate NFS PVs on capacity change",
    when: "3h",
    state: "deployed",
    additions: 8,
    deletions: 1,
  },
  {
    sha: "03eb0cf",
    message: "fix(web): wake and idle-reset work with modal open",
    when: "6h",
    state: "deployed",
    additions: 239,
    deletions: 33,
  },
  {
    sha: "6321698",
    message: "docs: frontend logs queryable in Postgres",
    when: "8h",
    state: "deployed",
    additions: 41,
    deletions: 9,
  },
];

const BASE = {
  status: "populated",
  deployedSha: "ea8aadd",
  deployedWhen: "14m ago",
  panelSha: "ea8aadd",
  commitsBehind: 0,
  run: null,
  failure: null,
  commits: COMMITS,
  staleFor: null,
} as const;

const RUN = { jobName: "build-web", stepName: "docker buildx", elapsed: "2m14s", progress: 0.62 };

const FAILURE = {
  jobName: "deploy",
  stepName: "pulumi up",
  logTail: "error: update failed\n  wwwinfra:imageDigests\n  expected 12 entries, got 11",
};

// ---------- Layout A , status dominant ----------

export const A_Status_UpToDate: Story = {
  args: { ...BASE, layout: DeployLayout.Status },
};

export const A_Status_Behind: Story = {
  args: {
    ...BASE,
    layout: DeployLayout.Status,
    panelSha: "676314c",
    commitsBehind: 2,
  },
};

export const A_Status_Deploying: Story = {
  args: {
    ...BASE,
    layout: DeployLayout.Status,
    run: RUN,
    commits: [{ ...COMMITS[0], state: "building" } as DeployCommit, ...COMMITS.slice(1)],
  },
};

// ---------- Layout B , pipeline rail ----------

export const B_Rail_Deploying: Story = {
  args: {
    ...BASE,
    layout: DeployLayout.Rail,
    run: RUN,
    commitsBehind: 1,
    panelSha: "676314c",
    commits: [{ ...COMMITS[0], state: "building" } as DeployCommit, ...COMMITS.slice(1)],
  },
};

export const B_Rail_Idle: Story = {
  args: { ...BASE, layout: DeployLayout.Rail },
};

// ---------- Layout C , failure forward ----------

export const C_Failure: Story = {
  args: {
    ...BASE,
    layout: DeployLayout.Failure,
    failure: FAILURE,
    deployedSha: "676314c",
    deployedWhen: "3h ago",
    commits: [{ ...COMMITS[0], state: "failed" } as DeployCommit, ...COMMITS.slice(1)],
  },
};

// ---------- Shared states ----------

export const Stale: Story = {
  args: { ...BASE, layout: DeployLayout.Status, staleFor: "42m" },
};

export const Loading: Story = {
  args: { status: "loading" },
};
