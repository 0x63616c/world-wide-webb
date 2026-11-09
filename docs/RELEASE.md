# Releases

Use the product's release handler and exact verified source. The monorepo candidate is still
local; channel flags, credentials and live runner/account checks must be completed before the
new workflows become production authority. Current evidence is in the migration tracker.

## Product handlers

Tendr and future standard iOS apps use the root locked Ruby bundle and explicit app selection:

```sh
bundle install
ruby scripts/check-release.rb
bundle exec fastlane ios verify app:tendr
bundle exec fastlane ios beta app:tendr
```

Tendr retains its existing automatic listing/screenshot/submission behavior, review coalescing
and storefront checks. Other standard apps follow their declared channels. Automatic standard delivery also requires
`STANDARD_IOS_DELIVERY_ENABLED`; explicit manual dispatch remains available for the handover canary. Root lanes reject
custom-handler products; do not route Folding, Callkeep or Control Center through this interface.
Historical Tendr release details remain in `docs/legacy-apps/RELEASE.md`; its old hosted-runner,
shared-package and repository-layout descriptions are superseded by the current workflows.

Folding owns `apps/folding/Gemfile`, Fastlane, immutable build ledger, backend-compatibility and
build-policy receipts. Its successful trusted-main CI attempt selects changed backend/native
inputs independently. Automatic beta delivery requires `FOLDING_DELIVERY_ENABLED`, scoped signing
and provider configuration, exact processed builds and confirmed internal-group membership.
Existing source-bound shipping/device deferrals remain explicit. Preview captures are separate
from the full App Store screenshot matrix and cannot satisfy its evidence requirements.

Callkeep owns signed universal archives, Apple notarization/symbol receipts, monotonic source
reservations and immutable private Git artifacts. `CALLKEEP_DELIVERY_ENABLED` remains gated on
actual signing/private Homebrew install and upgrade acceptance. The tap is the update authority;
no public appcast or public release download is needed. Older-source promotion is fenced before
changing the tap, including interrupted and ambiguous publication outcomes.

Control Center retains its native/Rust handler, exact built image and private home service.
Its native automatic publisher requires `PANEL_DELIVERY_ENABLED` before activation.
Homelab owns host configuration, monitoring and shared recovery; app deployment must not replace
those responsibilities. Homelab CLI distribution/deploy-ref/repository-rebind cutover is pending.

## Credentials and artifact ownership

Standard Apple workflows use the existing `ASC_*`, distribution certificate/profile and P12
secrets. Folding and Callkeep use their product-scoped configuration and secret names declared
in their workflows. Do not copy a complete vault into job-wide environment variables or reuse
unrelated product credentials. Signing and publication secrets enter only the steps that need them.
Use one primary-agent credential session; pass values directly to operations without displaying
or saving them in Git. Existing protected recovery material stays in its approved store.

Homebrew recipes pin private orphan artifact tags and exact commits in WWW. Authorized Git
access is required for artifact fetches separately from access to the tap. Preserve aliases,
app data, modes/symlinks and recovery artifacts. Fresh authorized install/upgrade and unauthorized
uncached rejection must pass before the tap switches. Source/tag checkout filtering prevents
source CI from downloading unrelated binary history.

## Verification and public pages

Required checks must be green for the exact source before delivery. Confirm Apple's processing
and group assignment, signed/notarized installation, current service revision/worker ownership,
retained data and backup/restore as applicable. An archive/upload alone is insufficient.
Independent final review precedes migration publication. WWW must be private before private
history is pushed, with successful CI and reviewed publication. The owner chose no GitHub branch protections or Pro upgrade;
GitHub does not enforce those automation gates against direct pushes.

Tendr's installed privacy/support URLs remain under the old apps Pages endpoint. The scoped
publisher sends generated static assets only; preserve that legacy host while those URLs are
needed. Folding retains getfolding.app. See `sites/README.md` for flags, ownership and live canaries.
Archive old source authorities only after consumers and recovery move; deletion is a separate
agreed cleanup decision. Preserve every excluded repository and active worktree.


Control Center image publication additionally requires `CONTROL_CENTER_IMAGE_DELIVERY_ENABLED`.
Keep it off during source handover; Docker build and local runtime checks still run. The existing
`OPEN_TOFU_DEPLOY_ENABLED` and `MINI_DEPLOY_ENABLED` switches also stay off until their separate
handover acceptance. Imported paths alone do not authorize a production apply or image publication.
