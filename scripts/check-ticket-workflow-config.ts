import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const configText = readFileSync(join(root, "opencode.jsonc"), "utf8");
const skillText = readFileSync(join(root, ".opencode/skills/writing-tickets/SKILL.md"), "utf8");
const builderAgentText = readFileSync(join(root, ".opencode/agent/ticket-builder.md"), "utf8");
const reviewerAgentText = readFileSync(join(root, ".opencode/agent/ticket-reviewer.md"), "utf8");

function assertIncludes(haystack: string, needle: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`Missing required text: ${needle}`);
  }
}

const requiredConfigText = [
  '"ticket"',
  "Use the writing-tickets skill",
  "Arguments: $ARGUMENTS",
] as const;

const requiredSkillText = [
  "name: writing-tickets",
  "Use for every ticket create/edit request",
  "including `/ticket`",
  "ticket-ready",
  "unless `--manual` is present",
  "one worktree",
  "machine-checkable",
  "dependency edges",
] as const;

const requiredBuilderText = [
  "name: ticket-builder",
  "model: openai/gpt-5.5",
  "steps: 80",
  "Never close Beads tickets",
  "Do not run `bd close`",
] as const;

const requiredReviewerText = [
  "name: ticket-reviewer",
  "model: openai/gpt-5.5-fast",
  "steps: 30",
  "verify acceptance criteria before giving a pass verdict",
  "final verdict of `pass` or `fail`",
] as const;

for (const needle of requiredConfigText) assertIncludes(configText, needle);
for (const needle of requiredSkillText) assertIncludes(skillText, needle);
for (const needle of requiredBuilderText) assertIncludes(builderAgentText, needle);
for (const needle of requiredReviewerText) assertIncludes(reviewerAgentText, needle);

JSON.parse(configText);
