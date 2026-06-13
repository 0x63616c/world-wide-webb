# Comments

First, write code obvious enough to not need a comment. Then comment only the non-obvious decision.

Good comments explain why something must be this way.

Good:

```ts
// Stripe retries webhooks, so this insert must be idempotent.
await db.insert(events).values(event).onConflictDoNothing();
```

Bad:

```ts
// Insert the event into the database.
await db.insert(events).values(event);
```

Good:

```ts
// Parse at the API boundary so domain code never handles unknown JSON.
const product = parseProduct(raw);
```

Bad:

```ts
// Validate product.
const product = parseProduct(raw);
```

Good:

```ts
// Do not accept plain strings here. Only parsed IDs are safe to use in queries.
function getProduct(id: ProductId) {}
```

Bad:

```ts
// Gets a product.
function getProduct(id: ProductId) {}
```

Good:

```ts
// Use desired state here, not reported state, so the UI reflects the user's tap immediately.
return mergeDeviceState(reported, desired);
```

Bad:

```ts
// Merge the reported and desired state.
return mergeDeviceState(reported, desired);
```

Template:

```ts
// Because <external constraint>, we <surprising choice>.
```

Delete stale comments aggressively. A wrong comment is worse than no comment.

Bad:

```ts
// Runs every minute.
const intervalMs = 5_000;
```
