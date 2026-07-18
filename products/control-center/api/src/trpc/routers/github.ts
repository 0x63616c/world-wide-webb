import { z } from "zod";
import { getGithubDeployStatus } from "../../services/github-actions-service";
import { publicProcedure, router } from "../init";

// Deploys tile read path. Everything here comes from Postgres (the worker's
// github-actions poll writes it); the api never calls GitHub.

const commitSchema = z.object({
  sha: z.string().describe("Full head SHA of the run's commit"),
  message: z.string(),
  author: z.string(),
  committedAtUtc: z.string().describe("Run start time, the push's wall-clock moment"),
  state: z
    .enum(["deployed", "building", "failed", "skipped"])
    .describe("Per-commit deploy outcome (deploy JOB conclusion, not run conclusion)"),
  changedFileCount: z.number().int().nullable(),
  additions: z.number().int().nullable(),
  deletions: z.number().int().nullable(),
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
    .object({ jobName: z.string(), stepName: z.string(), startedAtUtc: z.string() })
    .nullable()
    .describe("The newest run while it is in flight"),
  failure: z
    .object({ jobName: z.string(), stepName: z.string(), logTail: z.string().nullable() })
    .nullable()
    .describe("Set when the newest completed run concluded failure"),
  commits: z.array(commitSchema),
});

export const githubRouter = router({
  status: publicProcedure
    .input(z.object({}).optional())
    .output(deployStatusSchema)
    .query(() => getGithubDeployStatus()),
});
