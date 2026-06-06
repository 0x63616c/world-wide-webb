---
name: finish-ticket
description: Use when work on a control-center bd ticket is done and you are closing it out ("finish CC-xxx", "wrap up this ticket", "ship it", "close out"). Bulletproof finish — runs gates and REFUSES on red, verifies every AC item (screenshot@1366×1024 for UI), commits type(area/CC-xxx), merges the worktree to main with NO PR, pushes, closes the bd ticket, then does a harden-as-you-go audit. Pauses for confirm before push. You MUST run every step in order. Follows docs/ticket-standards.md.
---

# Finishing a ticket

The back bookend of the lifecycle. This is the *right* version of "remember to commit and merge" — a procedure that refuses to advance when a gate fails, not a reminder. Read `docs/ticket-standards.md` if you have not this session. It overrides `superpowers:finishing-a-development-branch` for this repo: the answer is **always merge to `main`, never a PR**.

**This is a rigid skill. Create a TodoWrite item per step and do them in order. If a gate fails, STOP and report — do not continue.**

## MUST do, in order

1. **Re-read the ticket.** `bd show <CC-xxx>`. List its AC/DoD checkboxes — these are what you must prove.

2. **Run the gates, capture the output, REFUSE on red.** From the worktree:
   ```bash
   bun run typecheck
   bunx biome check .
   bun run test            # vitest. NEVER bare `bun test`.
   bash scripts/check-fake-data.sh $(git diff --name-only main...HEAD)
   ```
   If any is red, STOP. Report the failing output verbatim. Do not commit, do not merge. Fix-then-rerun, or hand back to Calum.

3. **Verify each AC item with evidence** (invoke `superpowers:verification-before-completion`). For a **UI** ticket this MUST include an **agent-browser screenshot at 1366×1024** of the board showing the behavior — save under `docs/screenshots/` and reference it. Evidence before assertions; never tick a box you haven't observed.

4. **Commit.** Build a message the commit-msg guard will accept: `type(area/CC-xxx): desc`, where `type` comes from the ticket type (`feat|fix|refactor|chore|...`) and `area` is the ticket's area segment.
   ```bash
   git add -A
   git commit -m "type(area/CC-xxx): <imperative desc>"
   ```
   Never pass `--author`/`-c user.email` (global identity only). Keep commits focused; multiple commits are fine.

5. **PAUSE for Calum's confirm before pushing.** Summarize what will merge to `main`. Wait for go.

6. **Integrate to `main` — NO PR.**
   - **In a worktree:** merge the worktree branch back to `main` locally and push:
     ```bash
     cd <main checkout>
     git pull --rebase
     git merge --no-ff <worktree-branch>     # or fast-forward if clean
     git push
     ```
     Then `ExitWorktree({ action: "remove" })` once merged (only if clean).
   - **On `main` directly:** `git pull --rebase && git push`.
   - Confirm: `git status` shows **up to date with origin**.

7. **Close the ticket.** `bd close <CC-xxx>`. Optionally `bd comment <CC-xxx>` with the merge commit SHA for traceability.

8. **Harden-as-you-go audit.** Did this work reveal a durable rule, footgun, or invariant? Per the global "harden as you go" rule: write a memory (`bd remember`), add/strengthen a CLAUDE.md rule, or add a BLOCKING pre-commit guard so the regression can't return. File a bd ticket for anything bigger.

## Rules

- **Gates are a hard gate.** Red gates mean not done. No "I'll fix it after."
- **Never a PR.** Worktrees merge to `main` locally; that is the endpoint.
- **Work is not complete until `git push` succeeds** and `git status` is clean — per the project Session Completion protocol.
- **Spikes** finish differently: no code commit required. Record the decision (`bd decision` or a ticket note) with rejected alternatives, file follow-up tickets, `bd close`.
