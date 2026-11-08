# Native competition UI implementation

November 7, 2026. Feature implementation, not final visual or service acceptance.

- The native Apple authorization button supports an asynchronous injected sign-in
  command. The runtime performs challenge preparation and native authorization;
  the UI never creates credentials or considers authentication to be enrollment.
- Explicit Join presents the suggested editable nickname and optional local photo
  crop. Upload happens only after successful enrollment. An upload failure retains
  the draft in the now-joined profile instead of resubmitting enrollment.
- Profile supports nickname review state, bounded photo import, center crop/zoom,
  JPEG re-encoding, private pending preview, removal, and safe name rejection.
  Public rows use only approved derivative data supplied by the runtime.
- Leaderboards retain numerical ranks after hiding participants. Context menus
  expose reporting and hiding; profile settings allow showing hidden participants
  again. Pending folds remain separate. Comparison uses the eligible population
  threshold and server percentile rather than local rank arithmetic.
- Results have weekly/monthly pagination with request fencing and snapshot-version
  restart. Details use immutable finalized results; sharing re-fetches and matches
  period/version before rendering a preview. Live shares say Live placement and
  include the selected period and update time. Neither shares automatically.
- Leave and delete are distinct confirmed commands. A dedicated pending-removal
  state remains visible until the runtime confirms completion. Account/reset
  invalidation clears active/queued competition sheets and private result/profile
  caches, including a profile navigation stack inside Settings.

All mutations are injected commands. Nil capabilities do not pretend to work;
there is no competition fixture fallback in the app. The runtime owns server
state, authenticated image retrieval, moderation, deletion reauthentication and
polling, and publication/account fences. Tokens and internal identifiers do not
appear in user-facing copy or share cards.

Photo import follows Apple's [file-transfer guidance](https://developer.apple.com/documentation/coretransferable/filerepresentation):
check the imported file size, read at most 10 MiB plus a boundary byte, decode a
bounded thumbnail, and export a 512-pixel JPEG crop without original metadata.
Server-side bounds and moderation remain required.

The complete app plus widget extension compiled during this batch. Later runtime
mapping edits are integrated by the primary agent's combined compile. The string
catalog validates 203 semantic keys across ten locales; AI translations still
need native-speaker review. The owner directed final UI/race/security/device
reviews and expanded tests to the final pass. No native competition render,
Apple sign-in, App Attest, purchase, avatar moderation, report delivery, or live
leaderboard behavior is certified by this implementation note.
