# Compiler Baseline

Strict TypeScript is the first guardrail. Do not rely on agents remembering rules that the compiler can enforce.

Recommended baseline:

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

Why these matter:

- `strict` enables the main TypeScript safety checks.
- `noUncheckedIndexedAccess` makes `items[0]` return `T | undefined`.
- `exactOptionalPropertyTypes` distinguishes missing from explicitly `undefined`.
- `noImplicitOverride` catches accidental method shadowing.
- `useUnknownInCatchVariables` prevents assuming caught values are `Error`.
- `noPropertyAccessFromIndexSignature` makes dictionary access explicit.

Bad:

```ts
const firstName = users[0].name;
```

Good:

```ts
const firstUser = users[0];

if (!firstUser) {
  return { ok: false, error: "no_users" };
}

const firstName = firstUser.name;
```

Do not weaken TypeScript settings to make code compile. Fix the code or make the uncertainty explicit.
