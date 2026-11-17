---
name: tapes-import
description: Import TV shows and movies from ~/Downloads into the Tapes library on the NAS, with TMDB posters and episode stills. Use when the user asks to import, add or put a show, movie or download into Tapes.
---

# Import media into Tapes

`tapes_import.py` (beside this file) does the whole flow: it waits for downloads, imports each video
as it finishes, sets the poster and episode stills, checks the NAS copy, deletes the local copy, and
trashes the download folder once everything has gone in cleanly. `--help` has the usage. Run it with
`python3 -I`.

## Steps

1. **Identify** each item: show or movie, its title as the user would say it, and years. Find its TMDB
   path with `tapes_import.py search tv|movie "<title>"`; choose by year (remakes share titles).
2. **Library**: `/Volumes/Tapes/tapes-library.json` must exist and be writable. If not, ask the user to
   mount it (Finder ⌘K `smb://<NAS>/Tapes`). The Mac mini only mounts it read-only.
3. **Dry run** with `--dry-run`. Done when:
   - shows: no `UNMATCHED` files (otherwise pass `--pattern`), no `[still by none]`, and every
     combined file (`S03E18-E21`, `Episode 22 - 23`) has a short arc title via
     `--title S03E18="Sozin's Comet"`;
   - movies: the plan's video action and audio make sense (see Preferences).
4. **Run** each item as its own background command, without `--dry-run`. It can start while the
   download is still going. A show run finishes 30 minutes after its last file settles; a movie run
   finishes once its one file is imported and checked.
5. **Report** from `~/.local/state/tapes-import/<slug>/log.txt` when it exits: counts, and every
   `FAIL`, `KEPT` or `SKIP` line. A run with any FAIL/KEPT, or files left, keeps the download folder
   for the user to decide.

## Preferences

- Local copies go only after the NAS copy's duration matches (±2 s). The script enforces this.
- Featurettes, extras and anything under 10 minutes stay out of the library and are trashed with the
  download folder. Ask before deleting anything else in ~/Downloads.
- Posters are portrait (the TMDB w500 `og:image`). Episode stills match by title, since TMDB merges
  some two-parters and its numbers drift from the files'.
- Playback target is an Apple TV 4K 2nd gen (no AV1); `tapes import` re-encodes what it can't play.
  Expect DVD XviD rips to be slow (HEVC re-encode). TrueHD becomes E-AC-3 and loses Atmos.
- Keep progress in the log and in chat; the app gets no import-progress UI.
