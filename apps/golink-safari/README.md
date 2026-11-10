# Golink for Safari

Type `go/repo` in Safari’s address bar, with Google as the search engine and Tailscale connected.
The extension recognizes the complete `go/<path>` search and opens
`https://go.tail8c014d.ts.net/<path>`. No scheme or trailing slash is required.
This is a client for the existing [tailnet Golink service](../../homelab/docs/golink.md);
it does not change the server or manage saved links.

## Enable

Install the containing Golink app, then enable its extension:

- **Mac:** open Golink and choose **Open Safari Extension Settings**. Turn on Golink.
- **iPhone/iPad:** open **Settings → Apps → Safari → Extensions → Golink** and turn it on.

Allow access to **google.com** and **www.google.com** in Safari’s extension settings.
The toolbar popup reports whether those permissions and the redirect rules are ready.
Private Browsing requires Safari’s separate permission. Other search engines and regional
Google domains are outside this version’s two explicit host permissions.

## Build and install

Requirements: Xcode 27.2, XcodeGen, Bun 1.4.4. The project is generated from `project.yml`.
All commands below run from `apps/golink-safari`.

```sh
bash Scripts/build.sh macos CODE_SIGNING_ALLOWED=NO
bash Scripts/build.sh simulator CODE_SIGNING_ALLOWED=NO
```

Those are verification builds. Safari installation needs trusted Apple signing.
For a Developer ID Mac release, use an identity installed in your keychain:

```sh
bash Scripts/build.sh macos-release \
  'CODE_SIGN_IDENTITY=Developer ID Application: NAME (TEAM)'
codesign --verify --deep --strict build/macos-release/Build/Products/Release/Golink.app
```

The release preset builds both Mac architectures, requests secure signing timestamps,
and disables injected development entitlements (including `get-task-allow`).
Notarize a ZIP made with `ditto -c -k --keepParent`, staple the accepted ticket to
`Golink.app`, and verify with `spctl --assess --type execute`. Keep the notarization
key outside Git. Install the accepted app in `/Applications` or `~/Applications`,
open it once, and enable the extension in Safari. Do not disable Safari’s extension
signature protections for distribution.

For a physical iPhone/iPad, generate/open `Golink.xcodeproj`, select **Golink-iOS**,
choose your Apple development team and a connected device, and run. Automatic signing
must provision both `co.calum.golink` and `co.calum.golink.Extension`. A simulator build
does not prove a physical-device install or App Store/TestFlight availability. App Store
distribution additionally requires the corresponding App Store Connect setup and profiles.
No release workflow automatically publishes this product.

## Check

```sh
bash Scripts/check.sh javascript # URL/rule fixtures, any Bun host
bash Scripts/check.sh            # fixtures, real WebKit smoke, Mac and iOS simulator builds
```

The smoke test requires macOS 15.4+ and an active desktop session. It creates an isolated,
nonpersistent `WKWebExtensionController`; it does not change Safari settings. It verifies the
real engine accepts the DNR rules, routes `go/repo` through the packaged resolver to the fixed
tailnet URL, and loads an ordinary Google query unchanged. It cancels the final tailnet
navigation before any request reaches the service. The ordinary-search check needs Google
network access. Safari 27.2 is the verified engine; earlier Safari versions remain unverified.
CI owns only this product and never activates homelab services.

## Redirect behavior

Safari’s declarative network request rules intercept matching **main-frame** Google.com
`/search?q=...` navigations. They pass the original URL in an extension-page fragment; a
small resolver decodes the form query once and constructs a URL with a fixed HTTPS origin.
This preserves nested paths, `%` escapes, target query parameters and fragments. Safari’s
regex engine does not support alternation, so separate rules cover literal and encoded `/`.

Ordinary searches, phrases containing a go link, other hosts, other paths and subframes
are unaffected. Duplicate `q` parameters, malformed encoding, whitespace and backslashes
are rejected. A rejected intercepted input returns to Google with the same query and an
escaped leading `g` to prevent a redirect loop. Dot segments follow standard URL normalization;
they cannot change the destination origin. The extension does not accept configurable
redirect hosts, inject page scripts, use native messaging, or store queries, links or credentials.

DNR is applied before the matching search page loads once Safari grants site access. Safari
search suggestions, prefetch behavior and requests made before extension activation are
outside the extension’s control; this is not a guarantee that Google never receives typed text.

Apple references: [content blocking and DNR](https://developer.apple.com/documentation/safariservices/blocking-content-with-your-safari-web-extension),
[Safari redirect permissions](https://developer.apple.com/videos/play/wwdc2023/10119/),
[Safari extension packaging](https://developer.apple.com/safari/extensions/).
