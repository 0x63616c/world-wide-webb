/**
 * tRPC `deploys` facet (Track C, Wave 2). The Deploys tile's read path.
 * Everything here comes from Postgres (the worker's github-actions poll
 * writes it via service.ts's runGithubPollCycle); the api never calls GitHub.
 * Reaches the tRPC runtime ONLY through @app-kit/server. Codegen collects the
 * top-level key `deploys` off `api._def.record`.
 */
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { getGithubDeployStatus } from "./service";

const commitSchema = z.object({
  sha: z.string().describe("Full head SHA of the run's commit"),
  message: z.string(),
  committedAtUtc: z.string().describe("Run start time, the push's wall-clock moment"),
  state: z
    .enum(["deployed", "building", "failed", "skipped"])
    .describe("Per-commit deploy outcome (deploy JOB conclusion, not run conclusion)"),
  changedFileCount: z.number().int().nullable(),
  additions: z.number().int().nullable(),
  deletions: z.number().int().nullable(),
  htmlUrl: z.string().describe("GitHub Actions run page, opened from the detail view"),
});

const deployStatusSchema = z.object({
  configured: z.boolean().describe("False when GITHUB_ACTIONS_TOKEN is unset"),
  lastPolledAtUtc: z.string().nullable(),
  consecutiveFailures: z.number().int(),
  deployedSha: z.string().nullable().describe("SHA the cluster was last reconciled to"),
  deployedAtUtc: z.string().nullable(),
  mainHeadSha: z.string().nullable(),
  commitsBehind: z.number().int(),
  run: z
    .object({
      jobName: z.string(),
      stepName: z.string(),
      startedAtUtc: z.string(),
      htmlUrl: z.string(),
    })
    .nullable()
    .describe("The newest run while it is in flight"),
  failure: z
    .object({
      jobName: z.string(),
      stepName: z.string(),
      logTail: z.string().nullable(),
      htmlUrl: z.string(),
    })
    .nullable()
    .describe("Set when the newest completed run concluded failure"),
  commits: z.array(commitSchema),
});

const deployRouter = router({
  status: publicProcedure
    .input(z.object({}).optional())
    .output(deployStatusSchema)
    .query(() => getGithubDeployStatus()),
});

/** The branded `api` facet — single top-level key `deploys`. */
export const api = defineApi(router({ deploys: deployRouter }));
