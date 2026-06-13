# Impossible States

Model only valid states. Avoid boolean soup.

Bad:

```ts
type CheckoutState = {
  isLoading: boolean;
  isReady: boolean;
  isFailed: boolean;
  cart?: Cart;
  error?: Error;
};
```

This allows nonsense:

```ts
const state: CheckoutState = {
  isLoading: true,
  isReady: true,
  isFailed: true,
};
```

Good:

```ts
type CheckoutState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "ready"; cart: Cart; totalCents: number }
  | { status: "failed"; error: Error };
```

Each state has exactly the data it needs.

```ts
function renderCheckout(state: CheckoutState) {
  switch (state.status) {
    case "empty":
      return "Cart is empty";
    case "loading":
      return "Loading";
    case "ready":
      return `Total: ${state.totalCents}`;
    case "failed":
      return state.error.message;
    default:
      return assertNever(state);
  }
}
```

Use `never` to force exhaustive switches:

```ts
function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}
```

If a new state is added later, TypeScript errors until every switch handles it.
