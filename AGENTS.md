# Calum’s apps: project memory

- Start with [README.md](README.md). App code and core tests live in `apps/<app>`; shared SwiftUI components and `rframe` live in `packages/RDesign`.
- Follow [CONTRIBUTING.md](CONTRIBUTING.md). Use Conventional Commit PR titles and describe the change and validation.
- Git identity: **Calum <6991398+0x63616c@users.noreply.github.com>**. Never use `calum@users.noreply.github.com`. Make small logical commits. When publication is authorized, merge yourself once checks are green; no PR review is required. Explicit session instructions such as “do not push” take precedence.
- Black, white and graphite only; no green or teal. Keep copy minimal. Tendr dose entry uses mg only; preserve historical records and do not re-enable syringe units. No drug brand names or medical claims in listing copy or screenshots.
- Use **bun**, not npm or pnpm, for JavaScript tooling.
- Run core gates with `swift test --package-path apps/<app>` and `swift test --package-path packages/RDesign`. Native simulator builds need macOS/Xcode 26.2+. Tendr and Blockr projects are generated from app-local `project.yml`.
- Change impact comes from `scripts/affected <base> --intent verify|ship` and app-local `uses`/`paths`. Tooling edits verify every app and ship nothing; only changed apps with `testflight: true` upload. See [docs/RELEASE.md](docs/RELEASE.md).
- Shared release entrypoint: [fastlane/Fastfile](fastlane/Fastfile), configured by `apps/<app>/app.yml`. Read [docs/RELEASE.md](docs/RELEASE.md); `ruby scripts/check-release.rb` checks lane mechanics without Apple access. Uploading an IPA does not prove processing or internal-group availability.
- Pages source is `site/<app>`; `site/.legacy-root` preserves Tendr’s live URLs until the rename described in [docs/RENAME.md](docs/RENAME.md). Do not publish or rename repositories without authorization.
- Keep credentials, signing assets and personal health data out of commits. Use synthetic fixtures for screenshots.
- UI PRs must show screenshots from fixture data: the PR screenshots workflow posts each app's `pr_screenshot_test` screens; extend that test (or attach fixture screenshots) when a PR changes other screens. For component design options, render a `ComponentGallery` snapshot (light/dark sheet) rather than whole-app screenshots. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Maintaining this file

Keep only knowledge useful to almost every future session. Point to authoritative files and commands rather than repeating code. Prefer rewriting or pruning over appending, and preserve this concise bar for future agents.
