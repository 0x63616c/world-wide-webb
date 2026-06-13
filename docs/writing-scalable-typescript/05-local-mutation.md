# Local Mutation

Default to `readonly`. Make mutation explicit.

Good:

```ts
type Cart = {
  readonly items: readonly CartItem[];
};

type MutableCart = {
  items: CartItem[];
};

function addItem(cart: MutableCart, item: CartItem) {
  cart.items.push(item);
}
```

Better for most app code:

```ts
function withAddedItem(cart: Cart, item: CartItem): Cart {
  return {
    ...cart,
    items: [...cart.items, item],
  };
}
```

Local mutation is fine when it does not leak outside the function:

```ts
function groupByProduct(items: readonly CartItem[]) {
  const grouped = new Map<ProductId, CartItem[]>();

  for (const item of items) {
    const existing = grouped.get(item.productId) ?? [];
    existing.push(item);
    grouped.set(item.productId, existing);
  }

  return grouped;
}
```

Mutation is not the enemy. Hidden shared mutation is.
