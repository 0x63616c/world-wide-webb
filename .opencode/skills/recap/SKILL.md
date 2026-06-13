---
name: recap
description: Use when the user runs /recap, asks for a recap, asks "where are we", asks what happened so far, or says "full recap". Produces concise conversation recaps, with "full recap" meaning the entire session.
---

# Recap

Use this skill for `/recap`, natural-language recap requests, "where are we", "what did we do", or similar conversation-summary prompts.

## Scope

- `full recap` means the entire session.
- `last N messages` means only that range.
- Bare `recap` means the recent useful thread plus current state.

## Output Rules

- Aim for fewer than 10 lines total.
- Include only durable facts: decisions, files changed, commands/gates, tickets, commits, blockers, and next step.
- Show key code/file snippets when they clarify the recap, but keep snippets to one short line.
- When mentioning a `CC-*` ticket, include the ticket title too.
- Do not dump long timelines. Prefer compressed bullets.
- Always end with a one or two sentence `*Next steps:*` line.

## Shape

```text
State: current repo/session state.
Changed: files, commits, or tickets that matter.
Decision: key decisions or constraints.
Snippet: optional one-line code/file example.
*Next steps:* the next useful action or blocker, in one or two sentences.
```
