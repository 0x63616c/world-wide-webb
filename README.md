# control-center

Smart-home wall-panel dashboard for a fixed 1366×1024 iPad Pro display.

- `apps/web` — React board, renders tiles from shared `components/ui/` primitives
- `apps/api` — tRPC backend; services throw on error (never fake data)

```bash
bun run dev        # tilt up (local dev stack)
bun run test       # vitest
bun run typecheck  # tsc across workspaces
bunx biome check . # lint/format
```

See `CLAUDE.md` for architecture and conventions.
