# Production website deployment — November 7, 2026

The previously uploaded static Worker `folding-web-production` (version `d12c0df4-0f09-4303-ab6f-0bd4c9167c4f`) is now routed at `getfolding.app`. OpenTofu applied the inspected production saved plan: five resources added, zero changed, zero destroyed. Existing support-email DNS was preserved.

Before applying, Cloudflare API readback showed no existing dynamic-redirect phase ruleset, no apex A/AAAA website record, and no `www` record. The new canonical rule therefore did not replace another redirect policy.

Deployment checks:

- `https://getfolding.app/`: HTTP 200, HTML, configured CSP/referrer/content-type protection headers.
- `https://www.getfolding.app/privacy/?check=canonical`: HTTP 301 to `https://getfolding.app/privacy/?check=canonical`, preserving path and query.
- Encrypted production state backup verified: `backups/production/20261107T200913Z-36b7046c-e70c-49b6-a0bf-065eeae1ba93.tfstate`, SHA-256 `3481a5a87dc9dc8ef1ea3be6a5ac4faebfbfc53b247a10555118fdbc3a6c9f0a`.

The site says Coming soon. This deployment does not claim the app is available. Final visual, accessibility and privacy-content review remain pending; backend API routes and App Store submission are separate tasks.
