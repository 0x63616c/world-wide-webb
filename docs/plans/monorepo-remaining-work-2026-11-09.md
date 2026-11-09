# Finish the migration

Updated November 9, 2026. This is the current execution plan; it replaces the remaining-work
and verification requirements in earlier migration documents.

## Already done

- Source consolidation is merged into WWW. WWW is public.
- CI uses hosted runners, including `xcode-27` for Xcode 27.2 jobs.
  That image includes the pinned Xcode build and Duo runtime.
- Both Macs follow WWW; the handover was verified at `0b046d9`. Subsequent host changes
  follow their normal updater. The bedroom-switch worker was verified live.
- The old homelab repository is archived.
- Folding **1.0.0 (15)** is VALID and available in Folding Internal; future main delivery
  is enabled. App Store submission/device acceptance remain separate product work.

## Cloudflare and sites — complete

[PR #972](https://github.com/0x63616c/world-wide-webb/pull/972) handed publication to WWW.
[Sites](https://github.com/0x63616c/world-wide-webb/actions/runs/42649259019) published
legacy Pages assets and both Folding sites. Existing support/privacy URLs and Folding routes
were checked. The old apps site writer is disabled; its Pages host remains for installed URLs.
[Home Cloudflare apply](https://github.com/0x63616c/world-wide-webb/actions/runs/42649263710/attempts/2)
passed using the existing encrypted state and resources. No replacement state or infrastructure was created.

## Finish remaining references and cleanup

- Fix remaining app, CLI and Homebrew source/release references. Use the existing pipelines;
  account for WWW now being public rather than implementing the old private-download proposal.
- Update README, AGENTS and release instructions to describe the working setup.
- Retire superseded source writers once their workflows, downloads, issues and recovery readers
  use WWW. Keep the apps Pages repository writable while WWW publishes retained installed URLs.
  Keep Folding’s historical artifact repository available while legacy records reference it.
  Keep dotfiles and homebrew-tap separate; leave the agreed excluded projects alone.

## What counts as finished

The remaining paths and ownership point here, normal relevant CI passes, affected sites work,
and old repositories no longer own active jobs. Keep any real blocker visible; fix ordinary
issues as they arise. Do not manufacture releases to close the migration.

App Store submissions, complete screenshot sets, forced TestFlight uploads, Homebrew release
canaries and new-app tooling improvements can accompany the next real product work. They do
not block repository cleanup. No new shared UI library or CI redesign is part of this finish.

Backup/deployment redesign is tracked in #970 and service-scoped updates in #965.
Encrypted signing review is tracked in #967. These are separate follow-ups.

## Hosted Apple runner correction

The earlier claim that GitHub cannot provide Xcode 27.2 was incorrect: `macos-26` was checked
instead of the dedicated `xcode-27` label. The [current image inventory](https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md)
lists Xcode 27.2 (27B52) and Duo on iOS 27.2. Apple jobs use that hosted label.
The homelab runner infrastructure remains available; CI selection and delivery gates are unchanged.
