# Beads Archive

We stopped using **Beads (`bd`)** for task tracking on **2026-07-11**. It added more
overhead than it returned. This directory preserves everything that was in it so no
ideas are lost.

## Contents

| File | What it is |
| --- | --- |
| [`OPEN-IDEAS.md`](./OPEN-IDEAS.md) | Human-readable dump of the **146 open** tickets (the unfinished ideas), grouped by area and sorted by priority. Start here. |
| [`beads-export.jsonl`](./beads-export.jsonl) | Full raw export - all **800 issues** (open + closed) plus **50 bd memories**. One JSON object per line, from `bd export --all`. |

## Rehydrating (if ever needed)

The raw dump can be re-imported into a fresh Beads database:

```bash
bd import docs/beads-archive/beads-export.jsonl
```

But the intent is to work from `OPEN-IDEAS.md` directly and pull items into whatever
tracking replaces it - not to resurrect `bd`.
