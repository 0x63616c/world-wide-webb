---
name: tapes-import
description: Import TV shows and movies from ~/Downloads into the Tapes library on the NAS, with TMDB posters and episode stills, and DJ sets from YouTube or Photos. Use when the user asks to import, add or put a show, movie, DJ set, YouTube video, Photos video or download into Tapes.
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

## DJ sets

DJ sets are their own Tapes kind (not shows or movies) and need no TMDB lookup. `set <URL> --dj
"<DJ>" --title "<event or venue>"` downloads with yt-dlp (`brew install yt-dlp`), uses the YouTube
thumbnail as artwork, imports, verifies and trashes the download. Repeat `--dj` for b2b sets; add
`--date` when the performance date is known (the upload date usually is not it). Run several sets as
one sequential background command, the user's priority first. Downloads are paced (30–90 s between videos);
if YouTube still answers "Sign in to confirm you're not a bot" or HTTP 429, stop, `brew upgrade yt-dlp`
and wait an hour before resuming rather than retrying in a loop.

`--quality`: `h264` (default) is YouTube's 1080p H.264 and plays as-is; `1080` and `4k` take
VP9/AV1, which `tapes import` re-encodes to HEVC (8 Mb/s at 1080p, 25 Mb/s at 4K, so the NAS copy is
larger than the download). `--max-height 1080` turns a 4K source into a sharper 1080p.

`set` also takes a local file; it is trashed after import only when it sits under ~/Downloads.
Artwork is a same-named `.jpg` beside it, else a frame a tenth of the way in. For a video in the
user's Photos library (often iCloud-only), read its title and date from `Photos.sqlite` opened
read-only, then export the original, which downloads it from iCloud:
`osascript -e 'tell application "Photos" to export {media item id "<UUID>/L0/001"} to (POSIX file
"<~/Downloads folder>" as alias) with using originals'`. The Photos copy stays.

If an imported set does not show in the app, `curl -X POST http://homelab-mac-mini.local:4300/rescan`.

## Preferences

- Local copies go only after the NAS copy's duration matches (±2 s). The script enforces this.
- Featurettes, extras and anything under 10 minutes stay out of the library and are trashed with the
  download folder. Ask before deleting anything else in ~/Downloads.
- Posters are portrait (the TMDB w500 `og:image`). Episode stills match by title, since TMDB merges
  some two-parters and its numbers drift from the files'.
- Playback target is an Apple TV 4K 2nd gen (no AV1); `tapes import` re-encodes what it can't play.
  Expect DVD XviD rips to be slow (HEVC re-encode). TrueHD becomes E-AC-3 and loses Atmos.
- Keep progress in the log and in chat; the app gets no import-progress UI.
