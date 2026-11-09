# CLI releases

Source lives in `homelab/cli`. Install with `brew install 0x63616c/tap/homelab` and
update with `brew upgrade homelab`. Release downloads are public and require no GitHub login.
The CLI still uses GitHub authentication for managing your configuration repository.

`Homelab CI` builds and tests the portable Apple silicon CLI and matching host helper.
`Homelab CLI delivery` publishes that exact main-source tarball as
`homelab/vVERSION`, with asset `homelab-VERSION.tar.gz`; it never recompiles it.
It checks the successful CI attempt and named build, archive checksum, safe payload and
binary versions. The public download must match before it updates only `Formula/homelab.rb`.
The formula pins the ordinary release URL and SHA-256 and installs binaries, docs and schema.

Bump the CLI package version in `Cargo.toml` and `Cargo.lock` for runtime/schema releases.
A released version cannot be replaced; retrying publication uses the same checked artifact.
Documentation/test-only changes verify without republishing or activating hosts.
Host configuration promotion is independent of CLI publication.

There is no CLI delivery enable variable. The tap key retains its existing secret name,
`CALLKEEP_HOMEBREW_TAP_DEPLOY_KEY`, shared with the Callkeep publisher. The publishers
rebase their independent recipe updates before pushing to the tap.

The old `homelab-cli` repository retains historical public downloads after archival.
Historical schema IDs and pinned VM helper fixtures are intentionally preserved.
