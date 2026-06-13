# Branded Types

Use branded types when plain strings are too weak for IDs, tokens, slugs, or paths.

Bad:

```ts
function getProduct(id: string) {}
function getCustomer(id: string) {}

getProduct("cus_123");
```

Good:

```ts
declare const ProductIdBrand: unique symbol;
declare const CustomerIdBrand: unique symbol;

type ProductId = string & { readonly [ProductIdBrand]: "ProductId" };
type CustomerId = string & { readonly [CustomerIdBrand]: "CustomerId" };
```

Only parser code should create the brand:

```ts
function parseProductId(raw: unknown): Result<ProductId, "invalid_product_id"> {
  if (typeof raw !== "string" || !raw.startsWith("prd_")) {
    return { ok: false, error: "invalid_product_id" };
  }

  return { ok: true, value: raw as ProductId };
}
```

Use the brand at dangerous boundaries:

```ts
function deleteProduct(id: ProductId) {}
```

Now the wrong ID type is rejected:

```ts
declare const customerId: CustomerId;

deleteProduct(customerId);
```

A branded ID means the value crossed a boundary and passed validation. It is not just a convenient string.
