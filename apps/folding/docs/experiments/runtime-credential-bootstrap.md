# Runtime credential bootstrap — November 7, 2026

Created separate cryptographic secrets for staging and production using the primary agent's persistent credential session. Each environment has independently generated 32-byte random encryption, Apple-subject HMAC, network HMAC and APNs token HMAC keys. Values use unpadded base64url; the versioned encryption and subject keyrings start at `v1`.

| Environment | Folding 1Password item |
| --- | --- |
| Staging | `gaf2hqew2cvyhxogq3xrwndtam` |
| Production | `n7fymf4zyx5272sxxyjzd545ry` |

Items are titled **Folding staging runtime cryptographic keys** and **Folding production runtime cryptographic keys**. Each field was retrieved and compared with its generated value before reporting success. Values remain outside Git, arguments and logs; only references are recorded here. Rerunning bootstrap must reuse these items, never silently regenerate keys.

Secret binding names: `AUTH_ENCRYPTION_KEYS`, `AUTH_SUBJECT_HMAC_KEYS`, `AUTH_NETWORK_HMAC_KEY`, `APNS_TOKEN_HMAC_KEY`. Apple private-key recovery is documented separately in `apple-account-bootstrap.md` and supplies `APPLE_SIGN_IN_PRIVATE_KEY_PKCS8` and `APNS_PRIVATE_KEY_PKCS8`.

This records secure generation and recovery, not deployment or runtime acceptance. Installing bindings remains pending. APNs token-index key rotation requires the explicit binding migration/reset procedure; it must not be treated as an interchangeable signing-key rotation.

## Cloudflare deployment identity update

OpenTofu applied an in-place update to the existing owner deployment token: account-scoped Access Organizations Read for JWT issuer discovery and zone-scoped Dynamic URL Redirects Write for the canonical website redirect. No resources were destroyed or replacement token created. Permission IDs were resolved through Cloudflare's account token permission-group API. Authenticated organization readback returned `worldwidewebb.cloudflareaccess.com`. The encrypted bootstrap state recovery document was updated in the Folding vault. This does not enable API routes or claim admin authentication acceptance.

Reference: [Cloudflare account token permissions](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/subresources/permission_groups/).
