# Vendored agent skills

Repo-scoped [Agent Skills](https://agentskills.io) for Codex (and any agent that
reads `.agents/skills/`). Codex scans `.agents/skills` from the working
directory up to the repo root, so these are available everywhere in the repo.
Invoke one explicitly with `$<name>` (e.g. `$swiftui-liquid-glass`) or let the
agent pick it from its description.

Each folder is copied verbatim from upstream at the pinned commit below, with
the upstream license kept. Do not edit vendored files in place; to update,
re-copy from a newer upstream commit and bump the commit here.

| Skill | Use it for | Source (pinned) | License |
| --- | --- | --- | --- |
| `swiftui-liquid-glass` | Real iOS/iPadOS 26+ Liquid Glass APIs: `glassEffect(_:in:)`, `Glass` (`.regular`/`.clear`/`.identity`, `.tint`, `.interactive`), `GlassEffectContainer`, `glassEffectID(_:in:)`, `.buttonStyle(.glass)`/`.glassProminent` | [openai/plugins `plugins/build-ios-apps/skills/swiftui-liquid-glass`](https://github.com/openai/plugins/tree/0722921d5542fc593105c27bd52630babd8b8c2a/plugins/build-ios-apps/skills/swiftui-liquid-glass) @ `0722921d` | MIT (declared in the plugin's `.codex-plugin/plugin.json`), © OpenAI |
| `liquid-glass` | macOS 26+ Liquid Glass adoption: system glass first, `ToolbarSpacer`, `sharedBackgroundVisibility`, `backgroundExtensionEffect`, `scrollEdgeEffectStyle`, concentric shapes, custom glass only where needed | [openai/plugins `plugins/build-macos-apps/skills/liquid-glass`](https://github.com/openai/plugins/tree/0722921d5542fc593105c27bd52630babd8b8c2a/plugins/build-macos-apps/skills/liquid-glass) @ `0722921d` | MIT (declared in the plugin's `.codex-plugin/plugin.json`), © OpenAI |
| `swiftui-patterns` | macOS SwiftUI app structure: scenes, windows, commands, toolbars, settings, split views, inspectors, menu bar extras | [openai/plugins `plugins/build-macos-apps/skills/swiftui-patterns`](https://github.com/openai/plugins/tree/0722921d5542fc593105c27bd52630babd8b8c2a/plugins/build-macos-apps/skills/swiftui-patterns) @ `0722921d` | MIT (declared in the plugin's `.codex-plugin/plugin.json`), © OpenAI |
| `swiftui-expert-skill` | Modern SwiftUI correctness and performance (state/`@Observable`, layout, animation, lists, latest/deprecated APIs), with Liquid Glass and macOS scene/window references | [AvdLee/SwiftUI-Agent-Skill `skills/swiftui-expert-skill`](https://github.com/AvdLee/SwiftUI-Agent-Skill/tree/204dba7c67256a8b707ee3fbc5759a824191974f/skills/swiftui-expert-skill) @ `204dba7c` | MIT, © Antoine van der Lee (`swiftui-expert-skill/LICENSE`) |
| `animation-patterns` | SwiftUI animation on iOS/macOS (written against iOS 27 / macOS 27): springs and spring tuning, `PhaseAnimator`, `KeyframeAnimator`, `matchedGeometryEffect`/`matchedTransitionSource` zoom transitions, `symbolEffect`, `TimelineView`, `MeshGradient`, scroll/visual effects, Reduce Motion | [rshankras/claude-code-apple-skills `skills/design/animation-patterns`](https://github.com/rshankras/claude-code-apple-skills/tree/9ffb83138209057875698dd11c1720c657c47a92/skills/design/animation-patterns) @ `9ffb8313` | MIT, © Ravishankar (`animation-patterns/LICENSE`) |
| `apple-hig` | Apple Human Interface Guidelines for OS 27 with exact measurements (layout, typography, materials, components) for iOS, iPadOS, macOS, watchOS | [justinwetch/HIGAgentSkills](https://github.com/justinwetch/HIGAgentSkills/tree/2206ff935b4affa9ad249a5399a3e8e29f5f6edd) @ `2206ff93` (runtime files only, per its `scripts/package_runtime_zip.py`) | MIT, © Justin Wetch (`apple-hig/LICENSE`); see `apple-hig/NOTICE`: the HIG-derived references are distilled from Apple material the MIT license does not cover |

The Liquid Glass and animation API names above (`PhaseAnimator`,
`KeyframeAnimator`, `MeshGradient`, `TimelineView`, `matchedTransitionSource`,
`.breathe`/`.wiggle` symbol effects) were spot-checked against Apple's
developer documentation on 2026-10-29. Glass morphs (`glassEffectID`) are covered by the two
Liquid Glass skills rather than `animation-patterns`.

`liquid-glass` and `swiftui-patterns` mention sibling skills from the same
upstream plugin (`appkit-interop`, `build-run-debug`, `view-refactor`,
`window-management`) that are not vendored here; skip those pointers.
