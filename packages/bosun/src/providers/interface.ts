// Single method interface: take a ref string like "op://Vault/Item/field",
// "file:///path/to/secret", or "env://VAR_NAME" and return the resolved value.
export interface SecretProvider {
  resolve(ref: string): Promise<string>;
}
