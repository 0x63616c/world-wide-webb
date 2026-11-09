# Finish the migration

Updated November 9, 2026. This is the current execution plan; it replaces the remaining-work
and verification requirements in earlier migration documents.

## Already done

- Source consolidation is merged into WWW. WWW is public.
- GitHub-hosted runner changes are merged; homelab code remains here.
- Both Macs follow WWW and run the latest host configuration at `0b046d9`.
  Later `cf8734b` changes agent documentation only. The bedroom-switch worker is live.
- The old homelab repository is archived.

## 1. Cloudflare and sites first

- Point existing infrastructure and website workflows at the source paths in WWW.
- Move the remaining credentials, state references and deployment ownership that still depend
  on old repositories. Reuse existing resources and state; import retained resources if needed.
- Switch off each old deployment writer when its replacement takes over.
- Publish affected sites and check their existing URLs, including support/privacy pages.
  Keep the old apps Pages host if installed apps still need those URLs.

Finish this as one working batch. Use the existing build/plan checks, inspect infrastructure
changes before applying, and check the affected live URLs. Preserve unrelated resources.

## 2. Finish remaining references and cleanup

- Fix remaining app, CLI and Homebrew source/release references. Use the existing pipelines;
  account for WWW now being public rather than implementing the old private-download proposal.
- Update README, AGENTS and release instructions to describe the working setup.
- Archive superseded repositories once their workflows, downloads and consumers use WWW.
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
