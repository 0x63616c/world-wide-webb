"""Imports downloads into the Tapes library on the NAS, with TMDB artwork, and DJ sets from YouTube.

  tapes_import.py search tv|movie "<query>"
  tapes_import.py show <download folder> --show "<title>" --years 2005–2008 --tmdb tv/<id-slug>
                  [--title S03E10="Short title" ...] [--pattern REGEX] [--dry-run]
  tapes_import.py movie <download folder or file> --title "<title>" --year 2010 --tmdb movie/<id-slug>
                  [--dry-run]
  tapes_import.py set <YouTube URL or video file> --dj "<DJ>" [--dj "<b2b DJ>"] --title "<event>" [--date YYYY-MM-DD]
                  [--quality h264|1080|4k] [--max-height 1080] [--dry-run]

set downloads a YouTube video with yt-dlp into ~/Downloads/<slug>/ (YouTube thumbnail as the artwork)
or takes a local file (a same-named .jpg beside it is the artwork, else a frame), imports it, checks
the NAS copy's duration (±2 s) and trashes the download (local files only when under ~/Downloads). --quality picks the
YouTube stream: h264 (default) is 1080p H.264 that plays as-is; 1080 and 4k take VP9/AV1, which
tapes import re-encodes to HEVC (add --max-height 1080 to shrink a 4k source).

show/movie wait for downloads to finish, import each video as its size settles, set the poster
(and episode stills, matched by title), check the NAS copy's duration (±2 s) and delete the local
copy. When everything has gone in cleanly they trash the download folder (extras included) and the
artwork. Episodes under 10 minutes are skipped. --dry-run fetches artwork and prints the plan.
State, logs and artwork: ~/.local/state/tapes-import/<slug>/ (log.txt is the record).
"""

import argparse
import glob
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time

LIB = "/Volumes/Tapes"
ENV = dict(os.environ, TAPES_LIBRARY=LIB)
VIDEO = (".mkv", ".mp4", ".avi", ".m4v", ".mov", ".ts")
EXTRA_DIRS = re.compile(r"(?i)extra|featurette|special|bonus|behind|deleted|sample|tsv")
PATTERNS = [  # season, number, title; a "&E11" / "-E21" / " - 12" second number marks a combined file
    r"S(?P<season>\d+)\s*E(?P<number>\d+)(?:\s*[-&]\s*E?\d+)*\s*-\s*(?P<title>.+)",
    r"Season (?P<season>\d+) Episode (?P<number>\d+)(?:\s*[-&]\s*\d+)?\s*-\s*(?P<title>.+)",
    # Scene style: Show.S01E02.Title.Words.1080p.WEB...; the title stops at the first release word.
    r"S(?P<season>\d+)E(?P<number>\d+)(?:-?E\d+)*[._ ]+(?P<title>.+?)[._ ]+(?:\d{3,4}p|web|bluray|hdtv|x26[45]|hevc)\b",
]
RELEASE_TAIL = re.compile(r"\s*[\(\[][^\)\]]*(?:\d{3,4}p|x26[45]|hevc|bluray|web|dvd)[^\)\]]*[\)\]]\s*$", re.I)


def curl(url):
    # TMDB answers 403 to Python's urllib; curl with a browser agent works.
    return subprocess.run(["curl", "-sfL", "--max-time", "60", "-A", "Mozilla/5.0", url],
                          check=True, capture_output=True).stdout


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


class Run:
    def __init__(self, slug):
        self.dir = os.path.expanduser(f"~/.local/state/tapes-import/{slug}")
        self.art = os.path.join(self.dir, "art")
        os.makedirs(self.art, exist_ok=True)
        self.done_path = os.path.join(self.dir, "done.txt")
        self.done = set(open(self.done_path).read().splitlines()) if os.path.exists(self.done_path) else set()
        self.problems = 0

    def log(self, message):
        if message.startswith(("FAIL", "KEPT")):
            self.problems += 1
        line = time.strftime("%Y-%m-%d %H:%M:%S ") + message
        print(line, flush=True)
        with open(os.path.join(self.dir, "log.txt"), "a") as f:
            f.write(line + "\n")

    def mark(self, rel):
        self.done.add(rel)
        with open(self.done_path, "a") as f:
            f.write(rel + "\n")


def fetch_poster(tmdb, out):
    if os.path.exists(out):
        return
    page = curl(f"https://www.themoviedb.org/{tmdb}").decode()
    # The page carries two og:images: the w500 one is the portrait poster, the other a backdrop.
    image = re.search(r'og:image" content="[^"]*/w500/([A-Za-z0-9]+\.jpg)', page).group(1)
    open(out, "wb").write(curl(f"https://image.tmdb.org/t/p/original/{image}"))


def fetch_stills(tmdb, art):
    index_path = os.path.join(art, "index.json")
    if os.path.exists(index_path):
        return json.load(open(index_path))
    index, season = [], 0
    while True:
        season += 1
        try:
            page = curl(f"https://www.themoviedb.org/{tmdb}/season/{season}").decode()
        except subprocess.CalledProcessError:
            break
        cards = list(re.finditer(r'class="card"', page))
        if not cards:
            break
        for m in cards:
            chunk = page[m.start():m.start() + 3000]
            ep = re.search(r'data-episode-number="(\d+)"', chunk)
            img = re.search(r'/t/p/w227_and_h127_face/([A-Za-z0-9]+\.jpg)', chunk)
            name = re.search(r'<h3>.*?<a[^>]*>([^<]+)</a>', chunk, re.S)
            if not (ep and name):
                continue
            entry = dict(season=season, number=int(ep.group(1)), title=html.unescape(name.group(1).strip()), still=None)
            if img:
                target = os.path.join(art, f"S{season:02}E{entry['number']:02}.jpg")
                if not os.path.exists(target):
                    open(target, "wb").write(curl(f"https://image.tmdb.org/t/p/original/{img.group(1)}"))
                entry["still"] = target
            index.append(entry)
        time.sleep(0.5)
    json.dump(index, open(index_path, "w"), indent=1)
    return index


def key(title):
    t = title.lower().replace("&", "and")
    t = re.sub(r"\((?:parts? )?[0-9 and]+\)$", "", t.strip())  # "(1)", "(Parts 1 & 2)"
    t = re.sub(r"[^a-z0-9]", "", t)
    return re.sub(r"^the", "", t)


def still_for(index, season, number, title):
    """By exact title, then a unique long shared start, then by number: TMDB merges some
    two-part episodes, so its numbers can drift from the files'."""
    def names(e):
        return [key(p) for p in [e["title"], *e["title"].split(";")] if key(p)]

    def shared(a, b):
        n = 0
        while n < min(len(a), len(b)) and a[n] == b[n]:
            n += 1
        return n

    want = key(title)
    eps = [e for e in index if e["season"] == season]
    exact = [e for e in eps if want in names(e)]
    if exact:
        return min(exact, key=lambda e: e["number"])["still"], "title"
    close = [e for e in eps if max([shared(want, n) for n in names(e)] or [0]) >= 8]
    if len(close) == 1:
        return close[0]["still"], f"close title '{close[0]['title']}'"
    by_number = [e for e in eps if e["number"] == number]
    return (by_number[0]["still"], "number") if by_number else (None, "none")


def tidy_title(index, season, number, title):
    """An all-lowercase scene title takes TMDB's title for the same episode number."""
    if title != title.lower():
        return title
    match = [e for e in index if e["season"] == season and e["number"] == number]
    return match[0]["title"] if match else title.title()


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True).stdout.strip()
    try:
        return float(out)
    except ValueError:
        return None


def set_poster(poster, folder):
    for name, width in (("art.jpg", 1920), ("art-small.jpg", 480)):
        subprocess.run(["sips", "-s", "format", "jpeg", "--resampleWidth", str(width), poster,
                        "--out", os.path.join(folder, name)], check=True, capture_output=True)


def tapes_import(args):
    result = subprocess.run(["tapes", "import", *args, "--json"], env=ENV, capture_output=True, text=True)
    if result.returncode != 0:
        tail = (result.stderr or result.stdout).strip().splitlines()[-3:]
        return None, " | ".join(tail)
    return json.loads(result.stdout.strip().splitlines()[-1])["dir"], None


def wait_for_library(run):
    while not os.path.isfile(os.path.join(LIB, "tapes-library.json")):
        run.log(f"waiting: {LIB} is not mounted read-write (Finder ⌘K smb://<NAS>/Tapes)")
        time.sleep(300)


def videos(root):
    """Every video under root outside extras folders, including .part downloads."""
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not EXTRA_DIRS.search(d)]
        for f in filenames:
            base = f[:-5] if f.endswith(".part") else f
            if base.lower().endswith(VIDEO):
                found.append(os.path.join(dirpath, f))
    return sorted(found)


def parse(path, pattern, titles):
    name = os.path.splitext(os.path.basename(path).removesuffix(".part"))[0]
    for p in [pattern] if pattern else PATTERNS:
        m = re.search(p, name, re.I)
        if m:
            season, number = int(m.group("season")), int(m.group("number"))
            title = m.group("title").strip()
            if " " not in title:
                title = re.sub(r"[._]+", " ", title)
            while RELEASE_TAIL.search(title):
                title = RELEASE_TAIL.sub("", title)
            return season, number, titles.get(f"S{season:02}E{number:02}", title)
    return None


def trash(paths, run):
    paths = [p for p in paths if os.path.exists(p)]
    if paths:
        subprocess.run(["trash", *paths], check=True)
        run.log("trashed: " + ", ".join(paths))


def stable(path, sizes):
    """True once the file's size has held across two passes."""
    size = os.path.getsize(path)
    settled = sizes.get(path) == size
    sizes[path] = size
    return settled


def show(a):
    run = Run(slugify(a.show))
    titles = dict(t.split("=", 1) for t in a.title)
    poster = os.path.join(run.art, "poster.jpg")
    fetch_poster(a.tmdb, poster)
    index = fetch_stills(a.tmdb, run.art)
    root = os.path.abspath(a.root)

    if a.dry_run:
        per = {}
        for e in index:
            per[e["season"]] = per.get(e["season"], 0) + 1
        print(f"TMDB: {len(index)} episodes, {sum(1 for e in index if e['still'])} with stills, per season {per}")
        print(f"poster: {poster}")
        for path in videos(root):
            parsed = parse(path, a.pattern, titles)
            rel = os.path.relpath(path, root)
            if not parsed:
                print(f"UNMATCHED {rel}")
                continue
            season, number, title = parsed
            title = tidy_title(index, season, number, title)
            _, how = still_for(index, season, number, title)
            print(f"S{season:02}E{number:02} {title}  [still by {how}]{'  (downloading)' if path.endswith('.part') else ''}")
        skipped = [d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)) and EXTRA_DIRS.search(d)]
        print(f"left out (trashed at the end): {skipped}")
        return

    sizes, last_change, started = {}, time.time(), time.time()
    run.log(f"started {a.show} from {root}")
    while True:
        wait_for_library(run)
        all_videos = videos(root)
        for src in all_videos:
            rel = os.path.relpath(src, root)
            parsed = parse(src, a.pattern, titles)
            if src.endswith(".part") or rel in run.done or not parsed:
                continue
            if not stable(src, sizes):
                last_change = time.time()
                continue
            season, number, title = parsed
            title = tidy_title(index, season, number, title)
            label =f"S{season:02}E{number:02} {title}"
            length = duration(src)
            if not length or length < 10 * 60:
                run.log(f"SKIP {label}: only {(length or 0) / 60:.1f} minutes long")
                run.mark(rel)
                continue
            still, how = still_for(index, season, number, title)
            sidecar = os.path.splitext(src)[0] + ".jpg"  # tapes import picks it up as the still
            if still:
                shutil.copyfile(still, sidecar)
            folder, error = tapes_import(["episode", src, "--show", a.show, "--season", str(season),
                                          "--number", str(number), "--title", title, "--years", a.years])
            if error:
                run.log(f"FAIL {label}: {error}")
                run.mark(rel)
                continue
            show_folder = os.path.dirname(folder)
            if not os.path.exists(os.path.join(show_folder, "art.jpg")):
                set_poster(poster, show_folder)
                run.log("show poster set")
            copy = duration(os.path.join(folder, "video.mp4"))
            if copy and abs(copy - length) <= 2:
                os.remove(src)
                if os.path.exists(sidecar):
                    os.remove(sidecar)
                run.log(f"ok {label} (still by {how}; local copy deleted)")
            else:
                run.log(f"KEPT {label}: NAS length {copy} vs {length}")
            run.mark(rel)
        downloading = any(v.endswith(".part") for v in all_videos)
        if not downloading and time.time() - last_change > 30 * 60:
            break
        if time.time() - started > 48 * 3600:
            run.log("STOP: still running after 48 hours")
            return
        time.sleep(60)

    left = [v for v in videos(root) if os.path.relpath(v, root) not in run.done and parse(v, a.pattern, titles)]
    unmatched = [v for v in videos(root) if not parse(v, a.pattern, titles)]
    if run.problems or left or unmatched:
        run.log(f"FINISHED with folders kept: {run.problems} FAIL/KEPT, {len(left)} not imported, "
                f"{len(unmatched)} unmatched")
    else:
        trash([root, run.art], run)
        run.log(f"FINISHED: {len(run.done)} handled")


def movie(a):
    run = Run(slugify(f"{a.title} {a.year}"))
    poster = os.path.join(run.art, "poster.jpg")
    fetch_poster(a.tmdb, poster)
    path = os.path.abspath(a.path)
    folder = path if os.path.isdir(path) else None

    def source():
        candidates = videos(path) if folder else [path, path + ".part"]
        candidates = [c for c in candidates if os.path.exists(c)]
        return max(candidates, key=os.path.getsize) if candidates else None

    if a.dry_run:
        src = source()
        print(f"poster: {poster}\nsource: {src}")
        if src:
            r = subprocess.run(["tapes", "import", "movie", src, "--title", a.title, "--year", str(a.year),
                                "--dry-run", "--json"], env=ENV, capture_output=True, text=True)
            plan = json.loads(r.stdout.strip().splitlines()[-1])
            print(json.dumps({k: plan[k] for k in ("dir",)} | {"video": plan["plan"]["video"],
                             "audio": plan["plan"]["audio"], "badges": plan["plan"]["badges"]}, indent=1))
        return

    sizes = {}
    run.log(f"waiting for {path}")
    while True:
        src = source()
        if src and not src.endswith(".part") and stable(src, sizes):
            break
        time.sleep(60)
    wait_for_library(run)
    length = duration(src)
    dest, error = tapes_import(["movie", src, "--title", a.title, "--year", str(a.year)])
    if error:
        run.log(f"FAIL {a.title}: {error}")
        return
    set_poster(poster, dest)
    copy = duration(os.path.join(dest, "video.mp4"))
    if copy and length and abs(copy - length) <= 2:
        run.log(f"ok {a.title} ({copy:.0f} s, poster set)")
        trash([folder or src, run.art], run)
    else:
        run.log(f"KEPT {a.title}: NAS length {copy} vs {length}")


QUALITY = {  # yt-dlp format selectors; AAC audio so tapes import copies it
    "h264": "bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[vcodec^=avc1]",
    "1080": "bv*[height<=1080]+ba[ext=m4a]/bv*[height<=1080]+ba",
    "4k": "bv*+ba[ext=m4a]/bv*+ba",
}


def download(url, fmt, folder, run):
    run.log(f"downloading {url} to {folder}")
    # Paced like a person: YouTube answers bulk downloads with "Sign in to confirm you're not a bot".
    dl = subprocess.run(["yt-dlp", "-q", "--no-progress", "--no-playlist", "-f", fmt,
                         "--sleep-requests", "1", "--sleep-interval", "30", "--max-sleep-interval", "90",
                         "--merge-output-format", "mkv", "--write-thumbnail", "--convert-thumbnails", "jpg",
                         "-o", os.path.join(folder, "set.%(ext)s"), url], capture_output=True, text=True)
    src = os.path.join(folder, "set.mkv")
    if dl.returncode != 0 or not os.path.exists(src):
        run.log(f"FAIL download: {' | '.join((dl.stderr or dl.stdout).strip().splitlines()[-3:])}")
        return None
    return src


def dj_set(a):
    name = f"{' b2b '.join(a.dj)} {a.title}"
    run = Run(slugify(name))
    folder = os.path.expanduser(f"~/Downloads/{slugify(name)}")
    fmt = QUALITY[a.quality]
    if os.path.isfile(a.source):
        src = os.path.abspath(a.source)
        downloads = os.path.expanduser("~/Downloads") + os.sep
        folder = src if src.startswith(downloads) else None
        if a.dry_run:
            r = subprocess.run(["tapes", "import", "set", src, "--dj", a.dj[0], "--title", a.title, "--dry-run",
                                "--json"], env=ENV, capture_output=True, text=True)
            plan = json.loads(r.stdout.strip().splitlines()[-1])["plan"]
            print(f"set: {name}\nsource: {src}\nvideo: {plan['video']}\naudio: {plan['audio']}")
            return
    elif a.dry_run:
        out = subprocess.run(["yt-dlp", "-f", fmt, "--print", "%(title)s | upload %(upload_date)s | "
                              "%(duration_string)s | %(format)s | ~%(filesize_approx)s bytes", a.source],
                             capture_output=True, text=True)
        print(f"set: {name}\ndownload: {folder}\n{(out.stdout or out.stderr).strip()}")
        return
    else:
        src = download(a.source, fmt, folder, run)
        if not src:
            return
    wait_for_library(run)
    length = duration(src)
    args = ["set", src, "--title", a.title] + [x for dj in a.dj for x in ("--dj", dj)]
    if a.date:
        args += ["--date", a.date]
    if a.max_height:
        args += ["--max-height", str(a.max_height)]
    dest, error = tapes_import(args)
    if error:
        run.log(f"FAIL {name}: {error}")
        return
    copy = duration(os.path.join(dest, "video.mp4"))
    if copy and length and abs(copy - length) <= 2:
        run.log(f"ok {name} ({copy:.0f} s, {os.path.getsize(os.path.join(dest, 'video.mp4')) / 1e9:.1f} GB)")
        trash([p for p in (folder, run.art) if p], run)
    else:
        run.log(f"KEPT {name}: NAS length {copy} vs {length}")


def search(a):
    from urllib.parse import quote
    page = curl(f"https://www.themoviedb.org/search/{a.kind}?query={quote(a.query)}").decode()
    seen = []
    for m in re.finditer(rf'href="/({a.kind}/\d+[^"?]*)"', page):
        if m.group(1) not in seen:
            seen.append(m.group(1))
    print("\n".join(seen[:8]) or "no results")


p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sub = p.add_subparsers(dest="cmd", required=True)
s = sub.add_parser("search")
s.add_argument("kind", choices=["tv", "movie"])
s.add_argument("query")
s = sub.add_parser("show")
s.add_argument("root")
s.add_argument("--show", required=True)
s.add_argument("--years", required=True)
s.add_argument("--tmdb", required=True)
s.add_argument("--title", action="append", default=[], help='S03E10="Short title" for a combined file')
s.add_argument("--pattern", help="regex with season, number and title groups, if the built-in ones miss")
s.add_argument("--dry-run", action="store_true")
s = sub.add_parser("movie")
s.add_argument("path")
s.add_argument("--title", required=True)
s.add_argument("--year", required=True, type=int)
s.add_argument("--tmdb", required=True)
s.add_argument("--dry-run", action="store_true")
s = sub.add_parser("set")
s.add_argument("source", help="YouTube URL or local video file")
s.add_argument("--dj", action="append", required=True, help="repeat for back-to-back sets")
s.add_argument("--title", required=True, help="the event or venue, for example \"EDC Las Vegas 2024\"")
s.add_argument("--date", help="performance date, YYYY-MM-DD")
s.add_argument("--quality", choices=QUALITY, default="h264")
s.add_argument("--max-height", type=int)
s.add_argument("--dry-run", action="store_true")
a = p.parse_args()
{"search": search, "show": show, "movie": movie, "set": dj_set}[a.cmd](a)
