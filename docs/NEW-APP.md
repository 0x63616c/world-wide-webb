# Start an independent app

From the repository root:

```sh
scripts/dev new Samplr samplr
# Add a backend when the product needs one:
scripts/dev new Cloudr cloudr --backend cloudflare
```

The display name determines the lowercase folder; the suffix creates `com.calumwebb.samplr`.
The current scaffold creates a standalone SwiftUI/XcodeGen app with local components, Home and
Settings, a launch glyph/icon, a synthetic screenshot test, app.yml, listing/frame configuration
and public privacy/support page placeholders. It registers the static website in `sites/.pages`
and registers an explicit native CI/delivery unit, then generates the Xcode project when
XcodeGen is installed. Backend-only inputs do not select a native release. TestFlight starts disabled.

Implement the primary journey and replace placeholders. Review the app's actual data collection,
privacy/support copy, accessibility and offline/error behavior. Preserve independent styling.
Core tests, fixtures and hosted smoke tests belong with the app; add a backend only when the app
needs one. Use `scripts/dev apps` to list products and `scripts/dev check <folder>` to run their local
handler. `scripts/dev doctor` checks shared command availability without opening account sessions.
The optional Cloudflare preset adds an app-local TypeScript Worker, pinned Wrangler/Bun lockfile,
separate staging/production configuration, health/version route and route tests. No shared UI or
backend component library is introduced. `scripts/dev check <folder>` also runs its frozen install,
tests and both environment dry-run bundles; Linux CI additionally starts workerd and checks health.
Only selected standard apps with a backend enter that check; the template is verified when changed.
See the generated backend README for resource ownership, authentication and first delivery.

The agent performs supported account/API setup using the existing authorized credentials and
handlers. The scaffold itself does not provision resources, publish a Worker or register Apple
records. Automatic production backend promotion/account onboarding remain acceptance work.

Before automatic distribution, the agent should register/verify the bundle and capabilities,
resolve the App Store Connect record and internal group, configure signing, fill in the actual
numeric `apple_id`, and validate listing URLs/locales/export compliance. Use authorized APIs and
existing Fastlane handlers where supported. Ask the owner only for required account/2FA/legal
facts or a purchase; never invent those facts. Prove a signed, processed internal beta before
enabling its automatic channel. The existing `testflight` flag and explicit product selection
control delivery; a new manifest alone does not publish an app.

Run the standard checks and a simulator build. The template CI job builds a throwaway scaffold
on the homelab Mac profile; its result is not evidence that a new product's signing or account
setup is complete. See [development](DEVELOPMENT.md), [releases](RELEASE.md) and the product README.
