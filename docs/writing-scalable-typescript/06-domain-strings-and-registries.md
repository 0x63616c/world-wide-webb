# Domain Strings And Registries

Do not ban all strings. Ban scattered domain strings.

Bad:

```ts
type PaymentStatus = "pending" | "paid" | "failed";

if (status === "paid") {
  shipOrder();
}
```

Better:

```ts
export const PaymentStatus = {
  Pending: "pending",
  Paid: "paid",
  Failed: "failed",
} as const;

export type PaymentStatus =
  (typeof PaymentStatus)[keyof typeof PaymentStatus];

if (status === PaymentStatus.Paid) {
  shipOrder();
}
```

Best when metadata belongs with the value:

```ts
const PAYMENT_STATUS = {
  pending: { canShip: false },
  paid: { canShip: true },
  failed: { canShip: false },
} as const satisfies Record<string, { canShip: boolean }>;

type PaymentStatus = keyof typeof PAYMENT_STATUS;

function canShip(status: PaymentStatus) {
  return PAYMENT_STATUS[status].canShip;
}
```

Use this pattern:

```ts
const registry = { ... } as const satisfies SomeShape;
type Derived = keyof typeof registry;
```

Raw strings usually belong only in:

- Boundary parsers.
- Central registries.
- Tests.
- User-facing copy.
- Integration adapters that must send exact external API strings.

Everywhere else should use constants, branded types, or derived unions.
