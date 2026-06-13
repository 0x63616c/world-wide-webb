---
name: writing-scalable-typescript
description: Use when writing, editing, reviewing, or designing TypeScript/TS/TSX code, or when discussing scalable TypeScript, strictness, Result types, discriminated unions, branded types, boundary parsing, magic strings, exhaustive switches, or code comments.
---

# Writing Scalable TypeScript

Use this before TypeScript/TSX work in control-center.

Core rule: **make bad TypeScript hard to write.**

## Repo Context

This is a Bun TypeScript monorepo with React/TSX, Storybook, tRPC, Drizzle/Postgres, worker apps, Pulumi TypeScript infra, Vitest, Biome, Knip, and backend logging through `@repo/logger`.

Preserve existing repo conventions. In particular, API services often throw for unavailable integrations so tRPC/React Query retries can recover. Do not change that error architecture unless explicitly asked.

## Checklist

- Model state with discriminated unions, not boolean soup.
- Use exhaustive switches with `assertNever` for discriminated unions.
- Return `Result` for expected recoverable failures when callers should branch.
- Treat external data as `unknown` until parsed at the boundary.
- Use branded types for IDs, tokens, slugs, and dangerous strings.
- Default to `readonly`; keep mutation local and explicit.
- Put domain strings in registries and derive types from them.
- Avoid broad `as` casts outside parser, schema, or branding code.
- Comment why a decision is required, not what syntax does.
- Prefer compiler, lint, pre-commit, and CI checks over prose rules.

## Default Patterns

```ts
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

```ts
function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}
```

```ts
const registry = { ... } as const satisfies SomeShape;
type Derived = keyof typeof registry;
```

```ts
// Because <external constraint>, we <surprising choice>.
```

## Read More

Use the short guide files when the task touches that topic:

- `docs/writing-scalable-typescript/README.md`
- `docs/writing-scalable-typescript/00-compiler-baseline.md`
- `docs/writing-scalable-typescript/01-impossible-states.md`
- `docs/writing-scalable-typescript/02-explicit-failures.md`
- `docs/writing-scalable-typescript/03-boundary-validation.md`
- `docs/writing-scalable-typescript/04-branded-types.md`
- `docs/writing-scalable-typescript/05-local-mutation.md`
- `docs/writing-scalable-typescript/06-domain-strings-and-registries.md`
- `docs/writing-scalable-typescript/07-comments.md`
- `docs/writing-scalable-typescript/08-enforceable-guardrails.md`
