---
name: new-ticket
description: Use when Calum wants to create a ticket, file an issue, or capture work in the control-center repo ("new ticket", "file a bug", "add a task", "track this"). Drafts a Ready, standardized bd ticket , type, priority, area, checkbox AC with the per-type Definition of Done auto-appended , then creates it via bd. Follows docs/ticket-standards.md.
---

# New ticket

Create a **Ready** bd ticket that conforms to `docs/ticket-standards.md`. Read that doc if you have not this session , it defines the taxonomy, the Definition of Ready (DoR), the Definition of Done (DoD), and the AC format. This skill is the only blessed way to create tickets, because it bakes those standards in at birth.

## MUST do, in order

1. **Get the work in one line.** Take Calum's description. If he hasn't given one, ask for it.

2. **Infer the four DoR fields. Ask (AskUserQuestion) ONLY what is genuinely ambiguous** , usually nothing, occasionally priority or "spike vs feature":
   - **Type** → maps to a real bd type per the taxonomy table in the standards doc:
     `feature→feature`, `bug→bug`, `refactor→task` (+label `refactor`), `chore→chore`, `spike→decision`, `epic→epic`.
   - **Area** (commit scope segment): `web`, `web/tiles`, `api`, `bosun`, `ci`, `docs`, etc. This is mandatory , `/finish-ticket` builds the commit message from it.
   - **Priority** P0–P3 per the rubric (P0 = panel broken/wrong on-device; P3 = speculative/spike).
   - A short **imperative title**.

3. **Draft the acceptance criteria** as `- [ ]` checkboxes (never prose):
   - First, the **ticket-specific** observable behaviors (a file exists, a command exits 0, a tile renders X).
   - Then **auto-append the per-type DoD** checkboxes from the standards doc:
     - all code types get the base DoD line: `Gates green (test+typecheck+biome), no fake data, committed type(area/www-xxx), worktree→main merged + pushed, bd closed`.
     - **feature + UI** → add `agent-browser screenshot @1366×1024 verifies it`.
     - **bug** → add `regression test red-before / green-after`.
     - **refactor** → add `existing tests prove behavior unchanged`.
     - **spike** (`decision`) → do NOT add the code DoD; instead AC = `decision recorded (bd decision / note) + rejected alternatives; follow-ups filed as tickets`.
   - **epic** → no AC; note "AC = all children closed or deferred".

4. **Create it.** Bare `bd` (never `--global` for repo work):
   ```bash
   bd create --type <bdtype> --priority <0-3> \
     [--parent <EPIC>] \
     [--labels <area-or-spike-etc>] \
     "<imperative title>" \
     --acceptance "<the checkbox AC block>"
   ```
   - Spikes: add `--labels spike`.
   - Refactors: add `--labels refactor`.
   - If it belongs to an epic, pass `--parent`.

5. **Confirm back** the new id + a one-line summary, and whether it's Ready to `/starting-ticket`.

## Rules

- **Every ticket is Ready at birth** , type, priority, area, machine-checkable checkbox AC. No exceptions. A ticket you can't make Ready is an idea, not a ticket; sharpen it first.
- **Never** invent a bd type outside `bug|feature|task|epic|chore|decision` (e.g. `docs` is not a bd type , use `task`).
- File the ticket **before** starting the work, not after.
- Don't restate house rules by hand in AC , generate the DoD lines from the type.
