# Enforceable Guardrails

The strongest agent rule is: make prose executable.

Prefer:

- Compiler errors over style notes.
- Lint failures over review comments.
- Pre-commit guards over reminders.
- CI gates over trust.
- Central registries over repeated literals.

## Candidate Type-Aware Lint Rules

If this repo adopts type-aware ESLint alongside Biome, prioritize:

```jsonc
{
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/no-unsafe-call": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/switch-exhaustiveness-check": "error",
    "@typescript-eslint/strict-boolean-expressions": "error",
    "@typescript-eslint/no-unnecessary-condition": "error"
  }
}
```

## Custom Guard Targets

Ban broad casts outside parser, schema, or branding files.

Bad:

```ts
const product = raw as Product;
```

Good:

```ts
const product = ProductSchema.parse(raw);
```

Ban raw domain string comparisons outside registries, parsers, tests, and adapters.

Bad:

```ts
if (device.type === "light") {}
```

Good:

```ts
if (device.type === DeviceType.Light) {}
```

Require exhaustive switches for discriminated unions:

```ts
default:
  return assertNever(state);
```

Require boundary parsing for external data:

```ts
const raw: unknown = await response.json();
const product = ProductSchema.parse(raw);
```

## Local And CI Gates

Important checks should run locally and in CI:

```bash
bun run typecheck
bunx biome check .
bun run test
bun run knip
```

Repo-specific guards should be scripts, not memories. Examples:

```bash
scripts/check-no-raw-domain-strings.sh
scripts/check-no-broad-casts.sh
scripts/check-no-fake-data.sh
```

## Highest-Leverage Setup

If only five rules fit, choose these:

1. `strict` TypeScript plus `noUncheckedIndexedAccess`.
2. Type-aware lint rules for unsafe assignments, calls, member access, and floating promises.
3. Ban broad `as` casts outside parser, schema, and brand files.
4. Ban raw domain strings outside registries, tests, parsers, and integration adapters.
5. Require boundary schemas for all external data.
