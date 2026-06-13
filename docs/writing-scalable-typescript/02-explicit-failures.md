# Explicit Failures

Expected failures should be visible in the return type when the caller is meant to branch on them.

```ts
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

Good:

```ts
type PaymentError =
  | "invalid_amount"
  | "card_declined"
  | "network_unavailable";

function processPayment(amountCents: number): Result<Receipt, PaymentError> {
  if (amountCents <= 0) {
    return { ok: false, error: "invalid_amount" };
  }

  return { ok: true, value: { id: "rec_123", amountCents } };
}
```

Caller:

```ts
const result = processPayment(5000);

if (!result.ok) {
  return showPaymentError(result.error);
}

return showReceipt(result.value);
```

Bad for expected failures:

```ts
function processPayment(amountCents: number): Receipt {
  if (amountCents <= 0) {
    throw new Error("Invalid amount");
  }

  return receipt;
}
```

Throws are invisible to callers. A return type of `Receipt` does not show that declined payment is normal behavior.

Use this split:

- Expected failure, caller should recover: return `Result`.
- Programmer bug, impossible state, startup failure: throw.

Repo caveat: control-center API services intentionally throw for unavailable integrations or unconfigured dependencies, and the tRPC/React Query retry path depends on that convention. Do not rewrite those paths to `Result` without an explicit architecture decision.
