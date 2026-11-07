# Pass 7g verification

Xcodegen succeeds. All five explicit schemes build: WorldWideWebb (macOS), WorldWideWebb-iPad, WorldWideWebb-Snapshots, Panel, Panel-Smoke. Both prototype test suites pass 87 tests including the hosted geometry render; all eight UI tours pass, as do Panel unit and Panel-Smoke tests.

The live Home/More margin test measures left/top/right80 and bottom79.75 points, within ±0.5. Two unsuccessful safe-area experiments and the initial frame-alignment attempt are retained in preflight logs; only the GeometryReader correction is in final source. The lamp drag tour failed its 75–85% endpoint assertion once; its exact unchanged rerun passes. No expectations were widened or disabled. Original failure and passing rerun are retained in checklogs.tgz.

Twelve live screens validate with correct orientations and independent double-launch determinism. Maximum RGB MAE 0.000564/255, threshold0.5/255. Capture lock is held only during simulator phases. Full-resolution images stay outside Git. Lamps and Clock are pixel-identical to accepted7b captures; all unchanged detail comparisons are in unchanged-detail-comparison.tsv.

Three fixed-prompt independent reviews are running. This is a tested candidate, not an acceptance or gate claim. Protected full-screen page files remain unchanged. No push, PR or merge.
