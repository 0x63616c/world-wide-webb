# Writing Scalable TypeScript

Scalable TypeScript stays understandable and safe as the codebase grows, humans edit it, and agents generate code.

Core rule: **make bad code hard to write.**

Apply these rules before writing, editing, or reviewing TS/TSX in this repo.

## Tech Stack Context

This repo is a Bun monorepo using:

- React/TSX for the fixed wall-panel UI in `apps/web`.
- Storybook for component design and browser-backed stories.
- tRPC in `apps/api` with browser-safe types exposed through `packages/api`.
- Drizzle/Postgres for persistence.
- Worker apps for background reconciliation and media jobs.
- Pulumi TypeScript for infra in `infra/`.
- Vitest via `bun run test`, Biome via `bunx biome check .`, and Knip via `bun run knip`.
- Structured backend logging through `@repo/logger`.

Preserve repo conventions while applying the guide. In particular, existing API services often throw on unavailable integrations so React Query/tRPC recovery keeps working. Do not refactor that architecture into `Result` without an explicit design decision.

## Reading Order

1. [`00-compiler-baseline.md`](./00-compiler-baseline.md), strict TypeScript defaults.
2. [`01-impossible-states.md`](./01-impossible-states.md), discriminated unions and exhaustive switches.
3. [`02-explicit-failures.md`](./02-explicit-failures.md), `Result` for expected failures.
4. [`03-boundary-validation.md`](./03-boundary-validation.md), parse unknown data at boundaries.
5. [`04-branded-types.md`](./04-branded-types.md), newtypes for IDs and dangerous primitives.
6. [`05-local-mutation.md`](./05-local-mutation.md), readonly by default, mutation only when local.
7. [`06-domain-strings-and-registries.md`](./06-domain-strings-and-registries.md), no scattered magic domain strings.
8. [`07-comments.md`](./07-comments.md), comments explain why, not syntax.
9. [`08-enforceable-guardrails.md`](./08-enforceable-guardrails.md), make prose rules executable.

## Mental Model

```text
unknown input
  -> parse once
  -> branded/domain types
  -> discriminated unions
  -> explicit expected failures
  -> exhaustive switches
  -> local mutation only
  -> comments explaining why
```

## Highest-Leverage Rules

1. Use strict TypeScript and do not loosen compiler settings to pass.
2. Treat external data as `unknown` until parsed.
3. Avoid broad `as` casts outside parser, schema, or branding code.
4. Centralize domain strings in registries and derive types from them.
5. Model state with discriminated unions, not boolean soup.
