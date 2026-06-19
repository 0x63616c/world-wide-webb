import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const configText = readFileSync(join(root, "opencode.jsonc"), "utf8");
const skillText = readFileSync(join(root, ".opencode/skills/writing-tickets/SKILL.md"), "utf8");

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

for (const needle of requiredConfigText) assertIncludes(configText, needle);
for (const needle of requiredSkillText) assertIncludes(skillText, needle);

JSON.parse(configText);
