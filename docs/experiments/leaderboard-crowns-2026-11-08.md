# Leaderboard crowns and simpler results — November 8, 2026

Owner selected the rounded cartoon crown family with two metal colors, transparent backgrounds and a sideways pose. Regenerated the artwork to lean clockwise for top-right placement and end at a closed curved brim, with no visible interior. The fitted crown has about 45 degrees total clockwise tilt at the avatar’s top-right arc. An exterior-circle mask and matching contour make the brim follow the exact avatar/ring radius instead of floating above it. The podium keeps a larger centered gold avatar/crown; silver and bronze receive subdued static rings. Gold has a four-second ring shimmer and three small fading particles, scheduled only on the gold podium decoration. Reduce Motion uses a static ring without particles.

Removed percentile text, its localization key and unused app presentation/wire fields throughout the client; folds, rank, population and medals remain. Backend percentile fields/calculation remain compatible with older clients. The Summary Competition card already shows rank/folds and retains its persisted metric identifier.

## Verification

All 57 app-hosted checks passed, including direct native-view snapshots with fictional profiles; the final circle-fit adjustment separately passes the same snapshot renderer. The exported animation has 48 frames with distinct rendered frames. Swift formatting, 201 semantic keys × ten locales and source searches pass. Test portraits are resources of the test bundle only; no live account or private tracking data is involved. These are rendered app previews, not physical-device acceptance or TestFlight distribution.

Ignored captures: `build/previews/leaderboard-crowns-fitted.png` and `.gif` in the original workspace. Snapshot source: `CrownPreviewSnapshotTests.swift`. Crown atlas: `apps/ios/App/Assets.xcassets/CompetitionCrowns.imageset/crowns.png`; each metal is selected and trimmed once for display. The screenshot target includes the same component/assets as the app.

## Generated artwork

Built-in image generation produced the selected family and fictional portrait sheet. Crown output is the corrected `exec-091a470c-0ca5-4a51-b4f4-a97b6decbb38.png`; it was copied into the asset catalog, preserving transparency. The input reference remains in the generator output directory.

Final edit prompt:

> Edit this exact three-crown icon strip for placing crowns at the TOP RIGHT of circular profile photos. Preserve the chunky rounded three-prong cartoon style, thick outlines, two-color palettes, order (gold left, silver center, bronze right), matching geometry, equal cell sizes and generous spacing. Make TWO targeted corrections to ALL THREE crowns: (1) REVERSE THE LEAN: mirror the current crown geometry horizontally so each crown tilts about 12 degrees CLOCKWISE. The rim/band should slope DOWNWARD from left to right, and the center prong should lean toward the RIGHT. This must be the opposite lean from the reference. (2) REMOVE THE VISIBLE UNDERSIDE/INTERIOR completely. They must be flat front-face icons seen at eye level or slightly from above, never from below. Delete the large dark oval/ellipse currently beneath each band. The bottom silhouette must END at the thin outlined lower edge of the front brim, directly following the brim's gentle curve; there must be no extra dark oval mass, open mouth, interior cavity, lip underneath, back rim or hollow visible bottom. Think a simple flat cartoon crown that can sit directly against a person's hair with its lower edge, rather than hovering above a visible opening. Keep one simple front band outlined using the second darker color. Strict flat solid fill plus darker outline only, no gradients, no grain, no lighting or shadow. Actual transparent background, no text, no extra objects. Exactly three separate crowns in a horizontal row, identical geometry and angle across all metals.

Internal distribution, final visual acceptance and existing #47/F13 device checks remain open.
