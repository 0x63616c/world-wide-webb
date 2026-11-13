# Research references and confidence

Collected during planning through November 7, 2026. Research is not a substitute for compiling against the selected SDK and testing a real Duo. No physical-device experiments have been performed in this project.

## Apple platform and design

- [iPhone Duo developer hub](https://developer.apple.com/iphone-duo/)
- [Preparing for iPhone Duo](https://developer.apple.com/iphone-duo/prepare/)
- [Duo Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo)
- [Live hinge and scene walkthrough](https://developer.apple.com/videos/play/tech-talks/111464/): consulted for hinge state/angle APIs; does not establish suspended-app continuous tracking.
- [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass): reference identified; full page requires further review.
- [Apple localization guidance](https://developer.apple.com/localization/)
- [App Store localizations](https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations/)
- [CloudKit database scopes](https://developer.apple.com/documentation/cloudkit/ckdatabase)

## Security and competition

- [App Attest server validation](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server)
- [App Attest preparation](https://developer.apple.com/documentation/devicecheck/preparing-to-use-the-app-attest-service)
- [App Attest availability and extension limits](https://developer.apple.com/documentation/devicecheck/dcappattestservice/issupported)
- [Game Center score management](https://developer.apple.com/help/app-store-connect/configure-game-center/manage-scores-and-players/): considered as an alternative; a suitable self-service full-reset flow was not verified.
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Cloudflare Terraform application protection](https://developers.cloudflare.com/learning-paths/clientless-access/terraform/publish-apps-with-terraform/)

## Release and libraries

- [fastlane snapshot](https://docs.fastlane.tools/actions/snapshot/)
- [fastlane deliver](https://docs.fastlane.tools/actions/deliver/)
- [App Store asset upload API](https://developer.apple.com/documentation/appstoreconnectapi/uploading-assets-to-app-store-connect)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Ratings and reviews guidance](https://developer.apple.com/design/human-interface-guidelines/ratings-and-reviews)
- [Swift Snapshot Testing](https://github.com/pointfreeco/swift-snapshot-testing)
- [Swift Dependencies](https://github.com/pointfreeco/swift-dependencies)

## Competitors and naming

- [HingeWorthy directory entry](https://duoregistry.com/apps/hingeworthy): secondary evidence only. The developer website and direct App Store listing could not be fetched during research. The owner described the guided Shortcuts setup directly. Competitor feature coverage and any differentiator claims remain unverified.
- [Existing Foldr software](https://foldr.com/)
- [Existing Foldr video-organizing app](https://apps.apple.com/gb/app/foldr-save-organize-videos/id6774282659)

Existing-use research is not a trademark clearance or an App Store name reservation. No alternative domain availability has been checked. No claim is made that a competitor lacks localization or other proposed features.

- [Cloudflare Rust support](https://developers.cloudflare.com/workers/languages/rust/): backend direction is Rust compiled to WebAssembly using workers-rs.
