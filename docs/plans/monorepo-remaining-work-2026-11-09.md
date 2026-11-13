# Repository migration completion

Updated November 12, 2026. This completion record supersedes the former remaining-work plan
and historical migration acceptance checklists.

## Completed

- Independent apps live under `apps/`; product components and release handlers stay app-local.
- Homelab configuration and CLI live under `homelab/`. Both Macs follow WWW through the
  existing checked `deploy/homelab` promotion path.
- Cloudflare infrastructure and site source live in WWW. Existing encrypted state/resources
  were retained; Folding’s websites publish from WWW.
- Selective CI separates checks from publication. Hosted Apple jobs use their pinned toolchains,
  including `xcode-27` for Xcode 27.2/Duo; homelab runner infrastructure remains available.
- Callkeep and homelab CLI publish WWW release archives. Both Homebrew recipes use WWW URLs;
  the separate `homebrew-tap` remains the install/update entrypoint.
- Control Center’s Xcode 27.2 native and immutable backend delivery paths belong to WWW.
  Product layout changes and individual TestFlight delivery are normal product work.
- Superseded old app/Folding workflows were disabled before retirement. The obsolete legacy
  Pages publisher in WWW is removed; no automation should write to deleted source repositories.

## Retired repositories

On November 10, verified default-branch snapshots were added to private
`0x63616c/github-archive` under:

- `0x63616c/apps--2026-11-10-151601`
- `0x63616c/folding--2026-11-10-151607`
- `0x63616c/callkeep--2026-11-10-151610`
- `0x63616c/homelab--2026-11-10-151612`
- `0x63616c/homelab-cli--2026-11-10-151614`

All five original repositories were subsequently deleted at the owner’s explicit request.
These archive folders are code snapshots, not backups of GitHub issues, releases or all Git refs.
Imported source history remains in WWW; preserve old local checkouts/worktrees as historical
material and any active uncommitted work. The old Folding repository had no GitHub releases.
Develop and publish from WWW, never an archive snapshot or retired checkout.

`dotfiles`, `homebrew-tap`, private `github-archive`, signing storage and the agreed excluded
projects remain separate. No repository deletion or migration of those sources is implied.

## Separate follow-ups

Tendr's [#1007](https://github.com/0x63616c/world-wide-webb/issues/1007)
website move and app/listing URL update completed in
[#1015](https://github.com/0x63616c/world-wide-webb/pull/1015).
Existing installed links to the deleted GitHub Pages host still require an app
update; a replacement Cloudflare hostname cannot redirect that old host.

Open follow-ups:

- [#970](https://github.com/0x63616c/world-wide-webb/issues/970): backup/deployment design.
- [#965](https://github.com/0x63616c/world-wide-webb/issues/965): service-scoped updates.
- [#967](https://github.com/0x63616c/world-wide-webb/issues/967): encrypted signing-file review.

These follow-ups, individual product releases, device checks and App Store submissions do not
reopen source consolidation. There is no additional migration release or verification campaign.
