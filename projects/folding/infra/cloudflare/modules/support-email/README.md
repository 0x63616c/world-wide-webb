# Support forwarding

OpenTofu module for `support@getfolding.app` incoming forwarding. The destination is a sensitive runtime input from the Folding 1Password project connections item. Do not put it in public site assets or committed tfvars.

The destination address has already been verified in the Cloudflare account; this module deliberately does not recreate or own that shared account-level verification record. Email Routing owns its required mail DNS records. Inspect existing MX/TXT records before apply; do not overwrite another mail provider.

This module does not enable catch-all routing, outbound sending, or an email Worker. Replying from the custom address requires a separate supported sending configuration. Apply only from the production root with encrypted/recoverable state; standalone module validation is not an apply.
