# Boundary Validation

Treat external data as `unknown`. Parse it once at the boundary, then pass domain types inward.

Bad:

```ts
const product = (await response.json()) as Product;
```

That is not validation. It is a lie with syntax.

Good:

```ts
import { z } from "zod";

const ProductSchema = z.object({
  id: z.string().regex(/^prd_[a-zA-Z0-9]+$/),
  name: z.string(),
  priceCents: z.number().int().nonnegative(),
});

type Product = z.infer<typeof ProductSchema>;

function parseProduct(raw: unknown): Result<Product, "invalid_product"> {
  const parsed = ProductSchema.safeParse(raw);

  if (!parsed.success) {
    return { ok: false, error: "invalid_product" };
  }

  return { ok: true, value: parsed.data };
}
```

At the boundary:

```ts
const raw: unknown = await response.json();
const product = parseProduct(raw);

if (!product.ok) {
  return { ok: false, error: product.error };
}

return { ok: true, value: product.value };
```

Parse, do not just validate:

```ts
const parsed = parseProduct(raw);

if (!parsed.ok) {
  return parsed;
}

useProduct(parsed.value);
```

After parsing, domain code should not need to ask whether the value is valid.
