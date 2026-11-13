# Optional Today competition comparison

November 7, 2026. Implemented and generic simulator compilation passed.

Edit Summary includes Competition only while authenticated membership is joined and
unrestricted. The default time-unfolded/trend metrics are unchanged. The optional
card displays the accepted current-user rank and fold count from the real loaded
leaderboard snapshot, with that snapshot's period label. It never adds pending local
folds or derives a rank. Tapping it opens Leaderboard. Without a received current-user
row, the entry remains navigation only; it does not fabricate zero or a position.

Leaving hides both the card and editor option while retaining the user's prior
selection for a later rejoin. Existing translated labels are reused; localization
validation remains 214 keys × ten locales. Final-pass native rendering and membership/
period transition tests remain pending.
