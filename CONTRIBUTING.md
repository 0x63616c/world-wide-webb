# Contributing

Read `CODEBASE_OVERVIEW.md` and `AGENTS.md` for repository conventions,
worktrees, checks, and required PR screenshots.

[Tickets](https://tickets.worldwidewebb.co) is the sole source of truth for
work. This project's ticket prefix is `WWW`. File and track work in Tickets;
GitHub issues and Projects boards are retired. Use Tickets dependency edges
to record dependencies.

On the box, start work with:

```sh
P=$(job new world-wide-webb WWW-12 [slug])
source "$P/.job.env"
```

Use a task-named branch in the worktree. Source `.job.env` if present before
running checks, and run the relevant checks described in `AGENTS.md`.

PR titles must be Conventional Commits ending with a Tickets key, for example
`feat(app): add thing [WWW-12]`. Start the body with the linked ticket,
`Closes [WWW-12](https://tickets.worldwidewebb.co/t/WWW-12)`, or `Refs [WWW-12](https://tickets.worldwidewebb.co/t/WWW-12)` to link without closing. Include a summary, changes, testing,
and the screenshot required by the PR template. The PR conventions workflow
checks the title key and that the body links the same ticket (it prints the exact line to add); bots are exempt from the ticket-key check.

The Tickets GitHub webhook links the PR and moves the ticket to In review
when the PR opens and to Done on merge. Tickets API documentation lives in
`docs/API.md` in `0x63616c/tickets`.
