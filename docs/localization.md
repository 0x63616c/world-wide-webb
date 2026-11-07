# Localization implementation and QA

The app String Catalog is `apps/ios/App/Localizable.xcstrings`. English is the source; resource locales are `en`, `de`, `fr`, `es`, `es-419`, `ja`, `ko`, `pt-BR`, `zh-Hans`, and `zh-Hant`. These are the ten agreed launch locales. No RTL language is in launch scope. Storefront and push locale mappings remain separate release configuration; do not infer App Store identifiers from bundle identifiers.

The first catalog covers the current native presentation, accessibility text, app controller errors, and opening/closing App Intent titles and descriptions. Future notifications, widgets, purchases, profile/result screens, and tested step-by-step setup instructions must add keys and translations as their implementations land. This catalog alone does not complete launch localization or screenshot acceptance.

## Authoring contract

- Use stable semantic keys with an English `defaultValue` and translator context. Dates, numbers and durations use Foundation formatting; the app language follows the system's per-app language preference.
- Keep UI copy short. Preserve the product names Folding and Duo. Do not translate identifiers, JSON/CSV format acronyms, or the UTC abbreviation.
- A fold means a detected opening **or** closing transition. A cycle means a paired opening and closing. Neither term guarantees a measured full hinge sweep.
- Time unfolded is derived from sessions. Equivalent travel is a playful full-swing equivalent, never measured hinge movement. Preserve this distinction in every translation.
- Pending folds are awaiting backend acceptance, not accepted public score. Competition remains optional and private history stays personal.
- Destructive confirmation must explicitly cover history, scores and medals. Never shorten away an effect of reset.
- Interpolate complete localized strings instead of concatenating translated fragments. `leaderboard.pending` uses integer plural variations; singular/plural wording is locale-specific. CJK uses `other`; European locales include `one` and `other`, with `many` for French, Spanish and Brazilian Portuguese.
- New interpolation expressions require an explicit typed mapping in the validator. Do not guess `%@` versus `%lld`; compile the catalog and exercise the runtime string.

Non-English strings are AI drafts. The String Catalog's `translated` state means the entry is present for compilation; it does **not** mean a native speaker certified it. Native-speaking beta review of onboarding and destructive actions remains desirable. Failed language QA blocks release of that localization; do not silently omit a launch language or ship broken instructions.

## Apple system terminology

Only the localized app name is used in the current generic Shortcuts copy. Names were checked against Apple's own documentation on November 7, 2026:

| Resource locale | App name | Apple reference |
| --- | --- | --- |
| de | Kurzbefehle | [User guide](https://support.apple.com/de-de/guide/shortcuts/welcome/ios) |
| fr | Raccourcis | [Introduction](https://support.apple.com/fr-fr/guide/shortcuts/-apdf22b0444c/ios) |
| es | Atajos | [User guide](https://support.apple.com/es-es/guide/shortcuts/-apda2b83d0e0/ios) |
| es-419 | Atajos | [iPhone guide, Mexico](https://support.apple.com/es-mx/guide/iphone/iph47e1c9d7d/ios) |
| ja | ショートカット | [Running shortcuts](https://support.apple.com/ja-jp/guide/shortcuts/-apd5ba077760/ios) |
| ko | 단축어 | [Apple's app guide](https://support.apple.com/ko-kr/guide/shortcuts-mac/welcome/mac) |
| pt-BR | Atalhos | [User guide](https://support.apple.com/pt-br/guide/shortcuts/welcome/ios) |
| zh-Hans | 快捷指令 | [iPhone/iPad actions](https://support.apple.com/zh-cn/guide/shortcuts/apd5c2bd430f/ios) |
| zh-Hant | 捷徑 | [iPhone/iPad URL scheme](https://support.apple.com/zh-tw/guide/shortcuts/apda283236d7/9.0/ios/26) |

These references verify app names, **not** the target OS's Duo automation trigger/control labels or physical behavior. Versioned localized setup steps require inspection against the supported OS locale and the documented setup acceptance flow. Until supplied, the presentation reports missing setup instructions and does not pretend setup is complete.

## Checks

Run locally with Python 3 (standard library only):

```sh
python3 scripts/check-localization.py
python3 scripts/test-localization.py
```

The checker rejects missing/stale semantic keys, conflicting English defaults, missing launch locales, duplicate JSON keys, empty/incomplete entries, missing translator context, invalid plural trees and placeholder type/index changes. It extracts the project's explicit `String(localized:defaultValue:)` and `LocalizedStringResource(_:defaultValue:)` forms, rather than claiming to be a general Swift parser. New string-producing syntax and raw literals still require code review and Xcode extraction/build checks. Shared widget/push resources must be added to validation when their targets exist.

The regression suite deliberately mutates a valid catalog to prove these failures are rejected. A native Xcode build must also compile the catalog and App Intent metadata. Runtime review must verify real interpolation/plurals, language selection and layout; passing JSON checks is not visual acceptance.

## Local evidence (November 7, 2026)

- 125 semantic keys across ten locales passed structural validation and ten mutation regressions.
- Xcode compiled the catalog in the isolated native preview. Foundation resolved compiled translations in all ten locales, including 40 plural cases (0, 1, 2, and 1,000,000), string interpolation and Intent keys. Run `xcrun xcstringstool compile apps/ios/App/Localizable.xcstrings --output-directory <temporary-directory>` then `swift scripts/test-localization-runtime.swift <temporary-directory>` to repeat this check.
- Outer-display screenshots inspected in `build/ui-review/localization/`: German Today; German dark Settings at largest accessibility size; Japanese setup; Japanese leaderboard with interpolated pending count. Visible translated copy fits without observed overlap in these fixtures. Screenshots are local ignored artifacts, not release captures. The preview leaderboard period uses a fixed English fixture title; runtime composition must supply a localized period title.
- The primary Fastlane integration build compiled the real app catalog and opening/closing App Intent metadata; eight app-hosted tests passed in commit `1d2d8cb`. This does not verify delivery from an actual Shortcuts automation.

## Remaining acceptance

- Full release screenshot matrix, including both supported display widths, all screens/states and localized metadata, remains tracked in F11/F12.
- Existing Duo runtime issues remain open: native tabs currently appear as an icon-only right rail; inner-display capture is black. No localized outer-display screenshot resolves those issues.
- Native-speaking review is not yet recorded. Exact localized Duo automation steps, notification/widget copy, and finalized result/share screens are not yet implemented in this batch.
- Physical-device checks remain owner-approved deferrals to F13 after submission, never passed by simulator screenshots.
