# Private CLI releases

Source lives in `homelab/cli`; installation remains `brew install 0x63616c/tap/homelab`.
Homebrew uses authenticated HTTPS Git access to private WWW. Run `gh auth setup-git`
after signing in with an account that can read WWW, then use `brew upgrade` for updates.
The CLI does not query a public release endpoint.

`Homelab CI` builds and tests the portable Apple silicon CLI and its matching host helper.
`Homelab CLI delivery` consumes that exact main-source artifact; it never recompiles it.
The publisher checks the CI attempt, named build, archive checksum, payload boundaries and
both binary versions. It publishes a zero-parent immutable `dist/homelab/vVERSION` Git tag
containing only binaries, packaged docs/schema and their source-bound receipt.

Before the tap changes, the actual Homebrew downloader must fetch and stage the exact private
commit. The publisher compares every payload byte, executable flag and symlink with its
receipt, confirms anonymous download denial, and rejects an older or conflicting formula.
Only `Formula/homelab.rb` is updated. CLI delivery uses the existing repository-scoped tap key;
its current GitHub secret name is `CALLKEEP_HOMEBREW_TAP_DEPLOY_KEY` because Callkeep introduced it.
It is shared installation infrastructure, with no access to other repositories.

Bump the CLI package version in `Cargo.toml` and `Cargo.lock` with runtime/schema changes intended
for release. The first private version is 0.4.2. A version's artifact cannot be replaced; retrying
publication reuses the same checked artifact. Documentation/test-only changes verify without
republishing a CLI or activating hosts. Host source promotion is a separate workflow and flag.

`HOMELAB_CLI_DELIVERY_ENABLED` remains off during migration. Acceptance still requires successful
real main CI, authenticated fetch/staging, installation and `brew test`, matching CLI/helper
versions, and preserved existing profiles/recovery state. The new workflow and local tests alone
do not prove delivery. Keep the old repository and public releases until those checks pass.
Historical schema IDs and pinned VM helper fixtures remain deliberately preserved.
