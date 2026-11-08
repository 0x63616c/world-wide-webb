# Project-local agent skills

The 27 published engineering and productivity skills from [mattpocock/skills](https://github.com/mattpocock/skills) are vendored in `skills/`. Source revision: `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` (MIT license in `LICENSE`). The upstream `in-progress` and `misc` skills are excluded, matching its published plugin manifest.

`grill-with-docs` uses `grilling` and `domain-modeling`; all three are installed. The skills are available to repo-aware agents on their next turn. Run `setup-matt-pocock-skills` before using the broader engineering workflow; it configures issue tracking and domain document locations for this repo.

To update, compare the published skill list in upstream `.claude-plugin/plugin.json`, reinstall those paths into `.agents/skills`, and update the revision above and `LICENSE`. Review the diff before committing.
