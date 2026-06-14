---
name: commit-and-push
description: Use when the user runs /commit-and-push or asks to commit and push current work. Reviews the diff, creates an appropriate commit, pushes it, and verifies the branch is up to date.
---

# Commit And Push

Use this skill for `/commit-and-push`, "commit this", "commit and push", "ship these changes", or similar requests where the user wants the current work persisted to git and pushed.

## Outcome

End only when:

- intended changes are committed
- the commit message matches the repo's conventions
- `git push` succeeds
- `git status` shows the branch is up to date with its upstream

## Workflow

1. Read the repo's git workflow instructions before doing git work if they exist, especially `~/.claude/docs/git-workflow.md` in Calum's environment.
2. Inspect `git status`, `git diff`, `git diff --staged`, and `git log --oneline -10` before staging anything.
3. Identify which changes are intended for this commit. Do not stage unrelated user or agent changes.
4. If the repo requires ticketed commits, find the active ticket from the branch, recent work, or issue tracker. If no ticket exists and the hook requires one, create or claim the smallest appropriate tracking issue before committing.
5. Run the relevant verification for the changed files. Prefer focused checks for config/docs-only work, and full gates for code changes when practical.
6. Stage only the intended files.
7. Commit with the repo's required message format. Never pass `--author` or override git identity.
8. Push the current branch to its upstream. If upstream is missing, set it with `git push -u origin <branch>`.
9. Run `git status` after pushing and verify it reports the branch is up to date with upstream.

## Safety Rules

- Never use `git stash`.
- Never use destructive checkout/reset commands unless the user explicitly requested them.
- Never amend unless the user explicitly requested an amend.
- Never open a PR from this skill.
- Never commit secrets, `.env` files, private keys, or generated credential material.
- Never skip hooks or use `--no-verify`.
- If hooks fail, fix the issue and create a new normal commit attempt.
- If unrelated dirty files are present, leave them unstaged and mention them in the final summary.

## Verification Guidance

- Config-only opencode changes: run a quick opencode startup or help command, such as `opencode --help`.
- TypeScript or TSX changes: run the relevant typecheck/test command, and use `bun`/`bunx`, never npm/npx.
- UI changes: verify the page or story at the expected viewport and report what was checked.
- Docs-only changes: run formatting or the narrow docs/config check if the repo has one.

## Final Response

Report:

- commit SHA and subject
- pushed branch and upstream
- verification commands run and their result
- any unrelated changes left unstaged
