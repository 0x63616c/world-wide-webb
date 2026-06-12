---
name: starting-ticket
description: Use when Calum is about to start work on a control-center bd ticket ("start www-xxx", "let's work on this ticket", "pick up www-xxx"). Bulletproof start of work, Definition-of-Ready check, claim, pull, ticket-id-led worktree, red test first (TDD), surfaces the Definition of Done. You MUST run every step in order. Follows docs/ticket-standards.md.
---

# Starting a ticket

The front bookend of the lifecycle. This makes the *start* of work bulletproof: you cannot begin until the ticket is Ready, you are claimed on it, and you are isolated in a worktree with the finish-line in view. Read `docs/ticket-standards.md` if you have not this session.

**This is a rigid skill. Create a TodoWrite item per step below and do them in order. Do not skip or reorder.**

## MUST do, in order

1. **Read the ticket.** `bd show <www-xxx>`. Understand the AC and the type.

2. **Definition-of-Ready gate, REFUSE if unmet.** The ticket must have: a **type**, a **priority**, an **area** (inferable from labels/title or stated), and **checkbox acceptance criteria**. If any is missing, STOP, do not start. Tell Calum the ticket isn't Ready and offer to fix it via the `/new-ticket` standards. A non-Ready ticket is an idea, not work.

3. **Claim it.** `bd update <www-xxx> --claim` (atomically sets you as owner + status `in_progress`).

4. **Sync main.** From the main checkout: `git pull --rebase` so the worktree branches off fresh origin/main. (Beads `post-merge` pulls issues too.)

5. **Enter a ticket-id-led worktree.** `EnterWorktree({ name: "<www-xxx>-<short-slug>" })`. The name MUST lead with the ticket id (worktree guard + convention). All work happens here, never directly on `main`.

6. **Write the failing test first (TDD)**, for `feature` and `bug` types. Invoke the `superpowers:test-driven-development` skill. For a bug: reproduce it with a test that is **red** now. For a feature: write the test that asserts the new behavior, watch it fail. Refactor/chore/spike may skip if no behavior changes (refactor relies on the *existing* suite staying green).

7. **Surface the Definition of Done.** Echo the ticket's DoD/AC checkboxes so the finish-line is explicit before you write implementation code. This is what `/finish-ticket` will verify.

## Rules

- **No work outside a worktree.** The global worktree guard blocks branch creation outside one; this skill makes the worktree step mandatory, not incidental.
- **Claim before you code.** An `in_progress` claim is how the team (and the lint) knows the ticket is live and not stalled.
- **Red before green.** For features and bugs, a failing test exists before implementation. Evidence-first.
- Keep WIP small, prefer ≤ 2 tickets `in_progress`. Finish or defer before starting another.
- When the work is done, close out with **`/finish-ticket`**, never hand-roll the commit/merge/push/close.
