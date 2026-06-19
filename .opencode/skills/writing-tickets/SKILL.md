---
name: writing-tickets
description: Use for every ticket create/edit request, including /ticket, new ticket, file issue, split work, scope work, or edit Beads acceptance criteria. Creates or updates Beads tickets immediately with runnable workflow labels by default.
---

# Writing Tickets

Use this skill for every request to create, edit, split, scope, or prepare Beads tickets, including `/ticket`.

## Contract

- Create or update real Beads tickets immediately with `bd`; do not leave ticket drafts in chat.
- Default to workflow-runnable tickets by adding `ticket-ready` unless `--manual` is present.
- When `--manual` is present, create an ordinary Beads ticket and do not add `ticket-ready`, `ticket-review`, `ticket-verified`, `ticket-retry`, or `ticket-human`.
- Keep every runnable ticket scoped to one worktree and one logical change.
- Acceptance criteria must be checkbox-form, machine-checkable, and free of hidden human-only steps for runnable tickets.
- Add Beads dependency edges for ordering or blockers; do not describe dependencies only in prose.
- Put durable design context in Beads fields or comments, not standalone planning files.
- If the request is ambiguous, make the smallest safe ticket set and use `ticket-human` only for genuinely blocked/manual work.

## Runnable Labels

- `ticket-ready`: ready for the builder queue.
- `ticket-review`: ready for reviewer workflow.
- `ticket-verified`: reviewed and ready for serialized merge.
- `ticket-retry`: marks a prior failed attempt.
- `ticket-human`: escape hatch, keep the ticket open so downstream dependencies stay blocked.

## Creation Steps

1. Read any mentioned parent issue with `bd show <id>`.
2. Choose a real Beads type: `feature`, `bug`, `task`, `chore`, `epic`, or `decision`.
3. Choose priority `0` to `4` and an area label/metadata suitable for commit scope.
4. Write an imperative title and a concise description explaining why the work exists.
5. Write checkbox acceptance criteria with observable commands, files, UI states, or Beads state.
6. Run `bd create` with the title, type, priority, description, acceptance criteria, labels, and parent/dependency links.
7. For runnable tickets, add `ticket-ready` and any project labels needed by the workflow.
8. For `--manual`, skip runnable labels and explain the manual reason in the ticket description or notes.
9. Verify the created ticket with `bd show <id>` before reporting it.

## /ticket Examples

Runnable by default:

```bash
bd create "Add workflow queue filter" --type feature --priority 1 --labels ticket-ready,project-management --acceptance "- [ ] Queue filter appears in Project Management UI"
```

Manual ticket:

```bash
bd create "Decide App Store release name" --type decision --priority 2 --labels project-management --acceptance "- [ ] Decision recorded in Beads" 
```

## Output

Report the ticket id and title, the runnable/manual status, labels, and any dependency edges created.
