---
name: remember
description: Use when the user runs /remember, says remember this, save this, save globally, or save locally. Captures durable instructions or facts from the prompt or recent context, defaulting to global memory unless --local is provided.
---

# Remember

Use this skill for `/remember`, `remember this`, `save this`, `save globally`, `save locally`, or similar requests where Calum wants a durable instruction or fact saved for future agents.

## Default Behavior

- Default to `--global` when no scope is provided.
- Use `--local` only when Calum explicitly asks for local or repo-specific memory.
- If the user says `remember this`, `/remember this`, or gives an empty/ambiguous prompt, infer the memory from the recent conversation context and restate the exact memory before saving.
- If the instruction is unclear or could be harmful if persisted, ask one short clarifying question before writing.

## Scope Rules

### Global

Use global memory for preferences, recurring workflows, cross-repo behavior, identity, tooling habits, or anything Calum would expect every future session to know.

Preferred mechanisms, in order:

1. Use the `saving-a-memory` skill if it is available.
2. Update the user's global agent instruction file, such as `~/.Codex/AGENTS.md`, following that environment's memory conventions.
3. If the repo uses Beads and the fact is global, use the global Beads memory command only when that environment explicitly supports it.

### Local

Use local memory for repo-specific behavior only. In this repo, prefer `AGENTS.md` for local agent instructions.

When saving local memory:

- Write the rule into the most relevant section of `AGENTS.md`.
- Keep it short, direct, and actionable.
- Do not create separate memory files unless the existing repo conventions explicitly ask for them.
- If working from a git worktree, write local memory in the canonical repo checkout, not a disposable worktree path.

## What To Save

Save durable, reusable information:

- Calum's preferences
- repo conventions
- recurring gotchas
- process rules
- verified facts future agents need

Do not save:

- secrets or credentials
- temporary task state
- guesses or unverified claims
- long transcripts
- vague preferences that need clarification

## Writing Style

- Make the saved memory a rule, not a diary entry.
- Prefer one bullet or one short paragraph.
- Use forceful language for hard constraints: `ALWAYS`, `NEVER`, `MUST`.
- Include the reason only when it prevents future mistakes.

## Verification

After saving:

- Read back the changed line or memory output.
- Tell Calum where it was saved.
- If files changed, leave normal git workflow to the user's requested command unless they also asked to ship it.
