---
name: finish-ticket
description: Use when work on a control-center bd ticket is done and you are closing it out ("finish CC-xxx", "wrap up this ticket", "ship it", "close out"). Bulletproof finish, runs gates and REFUSES on red, verifies every AC item (screenshot@1366×1024 for UI), commits type(area/CC-xxx), pushes the branch, opens a PR to main, merges after green checks, closes the bd ticket, then does a harden-as-you-go audit. Pauses for confirm before push. You MUST run every step in order. Follows docs/ticket-standards.md.
---

# Finishing a ticket

The back bookend of the lifecycle. This is the *right* version of "remember to commit and merge", a procedure that refuses to advance when a gate fails, not a reminder. Read `docs/ticket-standards.md` if you have not this session. It overrides `superpowers:finishing-a-development-branch` for this repo: the answer is **open a PR to `main` and merge after green checks**.

**This is a rigid skill. Create a TodoWrite item per step and do them in order. If a gate fails, STOP and report, do not continue.**

## MUST do, in order

1. **Re-read the ticket.** `bd show <CC-xxx>`. List its AC/DoD checkboxes, these are what you must prove.

2. **Run the gates, capture the output, REFUSE on red.** From the worktree:
   ```bash
   bun run typecheck
   bunx biome check .
   bun run test            # vitest. NEVER bare `bun test`.
   bash scripts/check-fake-data.sh $(git diff --name-only main...HEAD)
   ```
   If any is red, STOP. Report the failing output verbatim. Do not commit, do not merge. Fix-then-rerun, or hand back to Calum.

3. **Verify each AC item with evidence** (invoke `superpowers:verification-before-completion`). For a **UI** ticket this MUST include an **agent-browser screenshot at 1366×1024** of the board showing the behavior, save under `docs/screenshots/` and reference it. Evidence before assertions; never tick a box you haven't observed.

4. **Commit.** Build a message the commit-msg guard will accept: `type(area/CC-xxx): desc`, where `type` comes from the ticket type (`feat|fix|refactor|chore|...`) and `area` is the ticket's area segment.
   ```bash
   git add -A
   git commit -m "type(area/CC-xxx): <imperative desc>"
   ```
   Never pass `--author`/`-c user.email` (global identity only). Keep commits focused; multiple commits are fine.

5. **Push the branch.** Confirm the branch is up to date and pushed to origin.

6. **Open a PR to `main`.**
   - **In a worktree:** push the branch and open a PR to `main`:
     ```bash
     git push -u origin <worktree-branch>
     gh pr create --base main --head <worktree-branch> --title "type(area/CC-xxx): <desc>" --body "Refs CC-xxx"
     ```
     Merge through GitHub only after required checks pass, then clean up the worktree once merged.
   - **On `main` directly:** create a branch first; protected `main` rejects direct pushes.
   - Confirm: PR is merged, branch is pushed, and local status is clean.

7. **Close the ticket.** `bd close <CC-xxx>`. Optionally `bd comment <CC-xxx>` with the merge commit SHA for traceability.

8. **Harden-as-you-go audit.** Did this work reveal a durable rule, footgun, or invariant? Per the global "harden as you go" rule: write a memory (`bd remember`), add/strengthen a AGENTS.md rule, or add a BLOCKING pre-commit guard so the regression can't return. File a bd ticket for anything bigger.

## Rules

- **Gates are a hard gate.** Red gates mean not done. No "I'll fix it after."
- **Use PRs.** Protected `main` requires a pull request; do not rely on direct pushes.
- **Work is not complete until `git push` succeeds** and `git status` is clean, per the project Session Completion protocol.
- **Spikes** finish differently: no code commit required. Record the decision (`bd decision` or a ticket note) with rejected alternatives, file follow-up tickets, `bd close`.
