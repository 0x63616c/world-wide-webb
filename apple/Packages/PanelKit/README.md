# PanelKit

Shared typed Swift REST transport, feature contracts and synchronization state. Platform views
live in the production app, not this package. Maintain the existing typed client for the Rust cutover;
`tools/check integration` exercises it against a real isolated server, including Photo Booth bytes.

Run `swift test --package-path apple/Packages/PanelKit`. Synthetic fixtures under Tests contain no user data.
Requests use versioned `/api/v1` routes and explicit methods over private Tailscale HTTPS. No user API or
Cloudflare credentials are involved. Redirects are rejected and mutations are not automatically retried.
