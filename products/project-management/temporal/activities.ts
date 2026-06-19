import { Context } from "@temporalio/activity";

export type ProjectSnapshot = {
  readonly issueCount: number;
  readonly loadedAt: string;
};

export async function loadProjectSnapshot(): Promise<ProjectSnapshot> {
  const activityType = Context.current().info.activityType;
  throw new Error(
    `Beads adapter is intentionally not implemented in www-3agy.5 (${activityType}); shell/git/bd I/O belongs in this Activity boundary.`,
  );
}
