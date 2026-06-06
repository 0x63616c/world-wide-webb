# Ticket standards & the dev lifecycle

The single source of truth for how work moves through this repo. Every ticket, every commit, every merge follows this. The three lifecycle skills (`/new-ticket`, `/starting-ticket`, `/finish-ticket`) automate the happy path; the lefthook guards make skipping the rules mechanically impossible. `ship` (the autonomous workflow) reuses the exact same taxonomy and Definition of Done.

> **TL;DR** — A ticket is *Ready* (has type, priority, area, checkbox AC) → you `/starting-ticket` (claim, worktree, red test first) → you build → you `/finish-ticket` (gates green, commit, merge to `main`, push, close). No PRs, ever. Worktrees merge to `main` locally.

---

## 1. The lifecycle

```
        /new-ticket            /starting-ticket                      /finish-ticket
  ┌──────────────────┐   ┌────────────────────────┐   ┌──────────────────────────────────────┐
  │ draft a Ready     │   │ claim + branch off main │   │ gates → verify AC → commit →           │
  │ ticket (DoR met)  │──▶│ in a ticket-id worktree │──▶│ merge to main (no PR) → push → close →  │
  │                   │   │ red test first (TDD)    │   │ harden-as-you-go audit                  │
  └──────────────────┘   └────────────────────────┘   └──────────────────────────────────────┘
       open                     in_progress                              closed
```

Each arrow is a skill. Each skill has a **MUST-run** checklist and refuses to advance when a gate fails. The state lives in beads (`open` → `in_progress` → `closed`); the evidence lives in git (worktree branch → merge commit on `main`).

---

## 2. Definition of Ready (DoR)

A ticket may not be **started** until all of these hold. `/starting-ticket` enforces this and refuses to claim a ticket that fails it.

- **Type** set (see taxonomy) — drives the AC template and the commit type.
- **Priority** set (P0–P3, see rubric).
- **Area** captured — the commit scope segment, e.g. `web/tiles`, `api`, `bosun`, `ci`. Stored in the ticket so `/finish-ticket` can build a guard-passing commit message.
- **Acceptance criteria** present, in checkbox form, machine-checkable (see §7).

A ticket that fails DoR isn't blocked work, it's an unfinished *idea*. Fix the ticket (via `/new-ticket` standards) before starting.

---

## 3. Ticket taxonomy

Type is the keystone. It maps to a real **bd type**, predicts the **commit type** (validated by the commit-msg guard), and selects the **DoD adder**. bd's real types are `bug | feature | task | epic | chore | decision` — our taxonomy maps onto them exactly so nothing is invented.

| Our type | bd `--type` | Commit type | What it is | DoD adder (beyond base) |
|---|---|---|---|---|
| **feature** | `feature` | `feat` | new panel capability | UI → screenshot @1366×1024 |
| **bug** | `bug` | `fix` | wrong behavior | TDD: a regression test that is red before, green after |
| **refactor** | `task` + label `refactor` | `refactor` | internal change, **no behavior change** | existing tests prove behavior unchanged; no new behavior |
| **chore** | `chore` | `chore`/`ci`/`build` | tooling, config, deps | the tool/config actually runs |
| **spike** | `decision` | *(usually none — may produce no code)* | investigate and decide | a recorded decision (`bd decision` or ticket note) + rejected alternatives; **replaces** "committed" |
| **epic** | `epic` | *(none)* | parent container | AC = all children `closed` or `deferred` |

This kills the "evaluate X" ambiguity: those are **spikes** (`decision` type). Closing one yields a recorded decision, not orphaned code.

---

## 4. Definition of Done (DoD)

The DoD lives **here, once**. Skills *generate* the relevant checkboxes into each ticket from its type — generated-per-ticket is fine, **hand-typed-per-ticket is the antipattern** (it drifts). The full rationale lives only in this doc.

### Base DoD — every code ticket (feature / bug / refactor / chore)

- [ ] `bun run test` green (vitest — **never** bare `bun test`)
- [ ] `bun run typecheck` green
- [ ] `bunx biome check .` clean
- [ ] No fake/placeholder data — `check-fake-data` guard green (no `FALLBACK`/`PLACEHOLDER`/unsanctioned `DEMO_`)
- [ ] Committed as `type(area/CC-xxx): desc` (commit-msg guard validates the scope + real ticket)
- [ ] **If in a worktree:** merged to `main` locally (NO PR) and pushed. **Else:** committed on `main` and pushed. `git status` shows up-to-date-with-origin.
- [ ] `bd close CC-xxx`

### Per-type adders

- **feature (UI):** an agent-browser screenshot at **1366×1024** verifies the behavior on the board.
- **bug:** the fix is driven by a regression test that fails before the fix and passes after.
- **refactor:** the existing suite proves behavior is unchanged; the diff introduces no new behavior.
- **chore:** the tool/config is demonstrated running (gate output or command transcript).
- **spike:** *not* a code DoD — a decision is recorded with rationale + rejected alternatives; any follow-up work is filed as new tickets.

### What a generated UI-feature ticket looks like

```
- [ ] <behavior 1, ticket-specific>
- [ ] <behavior 2, ticket-specific>
- [ ] agent-browser screenshot @1366×1024 verifies it
--- auto-appended from DoD by type ---
- [ ] Gates: bun run test + typecheck + bunx biome check green
- [ ] No fake data (check-fake-data guard green)
- [ ] Committed feat(web/tiles/CC-xxx); worktree→main merged + pushed; bd closed
```

The last three lines are the commit/merge discipline, baked into the checklist, generated not hand-typed.

---

## 5. Priority rubric

- **P0** — the wall panel is broken or wrong on-device, or this blocks daily use. Drop everything.
- **P1** — a core wall-panel feature, or a bug degrading daily use.
- **P2** — quality, polish, a non-blocking bug, a meaningful improvement.
- **P3** — speculative, nice-to-have, most spikes, future.

---

## 6. AC format rules

1. **Checkboxes only.** `- [ ]` per item. No prose run-on sentences (they aren't individually checkable).
2. **Machine-checkable.** Each item names an observable: a file that exists, a command that exits 0, a guard that stays green, a screenshot that shows X. Avoid "works well" without a check.
3. **Ticket-specific behavior first, generated DoD last.** Don't restate house rules by hand; let the skill append them.
4. **UI ⇒ a screenshot@1366×1024 item.** Always.
5. **Epics** carry no AC of their own — their AC is "all children closed or deferred."

---

## 7. The three lifecycle skills

| Skill | Fires when | MUST do |
|---|---|---|
| **`/new-ticket`** | "create a ticket", "file an issue", capturing work | Infer type+area+priority from a one-line description; draft imperative title + checkbox AC; auto-append the per-type DoD; `bd create` with `--type/--priority/--parent/--acceptance/--labels`. Enforce DoR at birth. |
| **`/starting-ticket`** | beginning work on a ticket | `bd show` + DoR check (refuse if unmet) → `bd update --claim` → `git pull --rebase` → `EnterWorktree` named `CC-xxx-slug` → write the red test first (feature/bug) → surface the ticket DoD. |
| **`/finish-ticket`** | work is done, closing out | Run gates capturing output (refuse if red) → verify each AC item (screenshot for UI) → commit `type(area/CC-xxx)` → **pause for confirm** → merge worktree→`main` (no PR) + push, or push on `main` → `bd close` → harden-as-you-go audit. |

All three are **rigid** skills: announce them, create a TodoWrite item per checklist step, follow exactly. They do not improvise away the discipline.

---

## 8. `ship` (the autonomous variant)

`ship` (`.claude/workflows/ship.mjs`) is the multi-agent pipeline for delivering a whole epic hands-off. It is the **same lifecycle, parallelized**: it scopes a validation contract into the epic `--design`, persists features as child tickets with this taxonomy + DoD, then builds each feature **in its own ticket-id-led worktree** (TDD, gates), validates each milestone with **perspective-diverse adversarial agents** (correctness / no-fake-data / screenshot-evidence) that gate identically to `/finish-ticket`, drains fix bugs, hardens, and finalizes — merging to `main`, never a PR. Model tiers: `opus` scopes, `sonnet` writes all code, `haiku` validates and bookkeeps (haiku never writes code). Resume a crashed run with `args.resume=<epicId>`.

Use the skills for everyday human-in-the-loop work; use `ship` when an epic is scoped and approved and you want it driven to done autonomously.

---

## 9. Enforcement matrix

What is truly mechanical (blocks at the git layer) vs skill-owned vs lint backstop.

| Rule | Enforced by | Strength |
|---|---|---|
| Commit names a real `CC-` ticket + area | `commit-msg` lefthook (`check-commit-msg.sh`) | **mechanical — blocks** |
| Feature work happens in a worktree | global `guard-worktree-git.sh` PreToolUse hook | **mechanical — blocks** |
| No fake data | `check-fake-data.sh` pre-commit | **mechanical — blocks** |
| No third-party scheduler / no home address / no secrets | the no-scheduler + no-address pre-commit guards + gitleaks | **mechanical — blocks** |
| Beads synced on push | `pre-push` lefthook (`bd dolt push`) | **mechanical** |
| No PRs, ship to `main` | global rule + `/finish-ticket` + `ship` | cultural + skill |
| Every ticket Ready (type/priority/area/AC) | `/new-ticket` at birth + `/starting-ticket` DoR gate + `lint-tickets.sh` | skill + lint |
| One AC format; spikes typed `decision` | `/new-ticket` generates it; `lint-tickets.sh` flags drift | skill + lint |
| Gates green before merge | `/finish-ticket` + `ship` validators + CI (`test` job gates `deploy`) | skill + CI |

`scripts/lint-tickets.sh` is advisory (non-blocking): it exports open issues and warns on missing AC, prose-format AC, untyped spikes, P0 aging, and `in_progress` tickets with no worktree/commits (stalled). Run it inside a backlog scrub. We can't hook `bd create` itself, so the lint is the drift backstop for tickets created off-skill.

---

## 10. Focus norm

Keep work-in-progress small: prefer **≤ 2** tickets `in_progress` at once per person. A long `in_progress` list with no commits is the stall signal the lint flags. Finish or defer before starting more.
