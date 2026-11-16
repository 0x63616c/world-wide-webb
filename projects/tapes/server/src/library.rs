//! The library folder: one folder per item, each with an `info.json`.
//!
//! ```text
//! <root>/tapes-library.json          marker; proves the share is really attached
//! <root>/movies/<slug>/info.json     + video.mp4, art.jpg, art-small.jpg
//! <root>/shows/<slug>/info.json      + art.jpg, art-small.jpg
//! <root>/shows/<slug>/<episode>/info.json + video.mp4 (art optional)
//! <root>/sets/<slug>/info.json       + video.mp4, art.jpg, art-small.jpg
//! ```
//!
//! A folder without `info.json` is ignored, so an import that has not finished is
//! never listed. The importer writes `info.json` last.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

pub const MARKER: &str = "tapes-library.json";
pub const INFO: &str = "info.json";
pub const VIDEO: &str = "video.mp4";
pub const ART: &str = "art.jpg";
pub const ART_SMALL: &str = "art-small.jpg";
pub const INFO_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Movie,
    Show,
    Episode,
    Set,
}

/// The contents of one `info.json`. Fields that do not apply to a kind are absent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Info {
    pub version: u32,
    pub id: String,
    pub kind: Kind,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    /// Shows only, for example "2005–2013".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub years: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub djs: Vec<String>,
    /// DJ sets only, ISO date (YYYY-MM-DD), optional.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seconds: Option<f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub badges: Vec<String>,
}

impl Info {
    pub fn new(kind: Kind, title: impl Into<String>) -> Self {
        Self {
            version: INFO_VERSION,
            id: new_id(),
            kind,
            title: title.into(),
            year: None,
            years: None,
            season: None,
            number: None,
            djs: Vec::new(),
            date: None,
            seconds: None,
            badges: Vec::new(),
        }
    }
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

/// One item found on disk, with the folder it lives in.
#[derive(Debug, Clone)]
pub struct Entry {
    pub info: Info,
    pub dir: PathBuf,
    pub has_art: bool,
    pub has_video: bool,
}

/// Everything found by one scan. Episodes are grouped under their show's id.
#[derive(Debug, Clone, Default)]
pub struct Library {
    pub movies: Vec<Entry>,
    pub shows: Vec<(Entry, Vec<Entry>)>,
    pub sets: Vec<Entry>,
    /// Folders that had an `info.json` that could not be read, with the reason.
    pub problems: Vec<String>,
}

impl Library {
    pub fn entries(&self) -> impl Iterator<Item = &Entry> {
        self.movies
            .iter()
            .chain(self.shows.iter().flat_map(|(show, eps)| std::iter::once(show).chain(eps)))
            .chain(self.sets.iter())
    }

    pub fn find(&self, id: &str) -> Option<&Entry> {
        self.entries().find(|e| e.info.id == id)
    }

    pub fn len(&self) -> usize {
        self.entries().count()
    }
}

pub fn write_marker(root: &Path) -> Result<()> {
    fs::create_dir_all(root)?;
    let path = root.join(MARKER);
    if !path.exists() {
        fs::write(&path, format!("{{\"version\": {INFO_VERSION}}}\n"))?;
    }
    Ok(())
}

/// Reads the whole library. Fails, rather than returning an empty library, when the
/// root or its marker is missing: an unattached share must not look like no media.
pub fn scan(root: &Path) -> Result<Library> {
    if !root.join(MARKER).is_file() {
        bail!("library unavailable: {} has no {MARKER}", root.display());
    }
    let mut library = Library::default();
    let mut seen = HashSet::new();
    let mut check = |entry: Entry, library: &mut Library| -> Option<Entry> {
        if seen.insert(entry.info.id.clone()) {
            Some(entry)
        } else {
            library
                .problems
                .push(format!("{}: duplicate id {}", entry.dir.display(), entry.info.id));
            None
        }
    };

    for dir in subdirs(&root.join("movies"))? {
        if let Some(e) = read_entry(&dir, Kind::Movie, &mut library.problems)
            && let Some(e) = check(e, &mut library)
        {
            library.movies.push(e);
        }
    }
    for dir in subdirs(&root.join("shows"))? {
        let Some(show) = read_entry(&dir, Kind::Show, &mut library.problems) else { continue };
        let Some(show) = check(show, &mut library) else { continue };
        let mut episodes = Vec::new();
        for ep_dir in subdirs(&dir)? {
            if let Some(e) = read_entry(&ep_dir, Kind::Episode, &mut library.problems)
                && let Some(e) = check(e, &mut library)
            {
                episodes.push(e);
            }
        }
        episodes.sort_by_key(|e| (e.info.season.unwrap_or(0), e.info.number.unwrap_or(0)));
        library.shows.push((show, episodes));
    }
    for dir in subdirs(&root.join("sets"))? {
        if let Some(e) = read_entry(&dir, Kind::Set, &mut library.problems)
            && let Some(e) = check(e, &mut library)
        {
            library.sets.push(e);
        }
    }
    library.movies.sort_by(|a, b| sort_title(&a.info.title).cmp(&sort_title(&b.info.title)));
    library.shows.sort_by(|a, b| sort_title(&a.0.info.title).cmp(&sort_title(&b.0.info.title)));
    library.sets.sort_by(|a, b| b.info.date.cmp(&a.info.date).then(a.info.title.cmp(&b.info.title)));
    Ok(library)
}

fn sort_title(title: &str) -> String {
    let lower = title.to_lowercase();
    lower.strip_prefix("the ").map(str::to_string).unwrap_or(lower)
}

fn subdirs(dir: &Path) -> Result<Vec<PathBuf>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut dirs = Vec::new();
    for entry in fs::read_dir(dir).with_context(|| format!("reading {}", dir.display()))? {
        let entry = entry?;
        let name = entry.file_name();
        if entry.file_type()?.is_dir() && !name.to_string_lossy().starts_with(['.', '@', '#']) {
            dirs.push(entry.path());
        }
    }
    dirs.sort();
    Ok(dirs)
}

fn read_entry(dir: &Path, expected: Kind, problems: &mut Vec<String>) -> Option<Entry> {
    let path = dir.join(INFO);
    if !path.is_file() {
        return None;
    }
    match read_info(&path) {
        Ok(info) if info.kind == expected => Some(Entry {
            has_art: dir.join(ART).is_file(),
            has_video: dir.join(VIDEO).is_file(),
            info,
            dir: dir.to_path_buf(),
        }),
        Ok(info) => {
            problems.push(format!("{}: expected {expected:?}, found {:?}", path.display(), info.kind));
            None
        }
        Err(error) => {
            problems.push(format!("{}: {error:#}", path.display()));
            None
        }
    }
}

pub fn read_info(path: &Path) -> Result<Info> {
    let text = fs::read_to_string(path)?;
    let info: Info = serde_json::from_str(&text)?;
    if info.version != INFO_VERSION {
        bail!("unsupported info version {}", info.version);
    }
    Ok(info)
}

/// Writes `info.json` through a temporary file and rename, so readers never see half of it.
pub fn write_info(dir: &Path, info: &Info) -> Result<()> {
    fs::create_dir_all(dir)?;
    let tmp = dir.join(".info.json.partial");
    fs::write(&tmp, serde_json::to_string_pretty(info)? + "\n")?;
    fs::rename(&tmp, dir.join(INFO))?;
    Ok(())
}

/// A folder-name-safe version of a title: lowercase ASCII words joined by hyphens.
pub fn slug(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() { "item".into() } else { out }
}

/// Picks `<parent>/<slug>`, adding `-2`, `-3`… if that folder is already taken.
pub fn free_dir(parent: &Path, name: &str) -> PathBuf {
    let base = slug(name);
    let mut candidate = parent.join(&base);
    let mut n = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{base}-{n}"));
        n += 1;
    }
    candidate
}

/// Groups DJ sets by DJ name, for listing.
pub fn sets_by_dj(library: &Library) -> BTreeMap<String, usize> {
    let mut map = BTreeMap::new();
    for set in &library.sets {
        for dj in &set.info.djs {
            *map.entry(dj.clone()).or_insert(0) += 1;
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    fn add(root: &Path, rel: &str, info: &Info, video: bool) {
        let dir = root.join(rel);
        write_info(&dir, info).unwrap();
        if video {
            fs::write(dir.join(VIDEO), b"video").unwrap();
        }
    }

    #[test]
    fn missing_marker_is_unavailable_not_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let error = scan(tmp.path()).unwrap_err().to_string();
        assert!(error.contains("library unavailable"), "{error}");
    }

    #[test]
    fn scans_items_and_skips_unfinished_and_bad_folders() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write_marker(root).unwrap();
        let mut movie = Info::new(Kind::Movie, "The Heat");
        movie.year = Some(1995);
        add(root, "movies/heat", &movie, true);
        add(root, "movies/drive", &Info::new(Kind::Movie, "Drive"), true);
        fs::create_dir_all(root.join("movies/unfinished")).unwrap();
        fs::write(root.join("movies/unfinished/.video.mp4.partial"), b"x").unwrap();
        fs::create_dir_all(root.join("movies/broken")).unwrap();
        fs::write(root.join("movies/broken/info.json"), b"{nope").unwrap();

        let show = Info::new(Kind::Show, "The Office");
        add(root, "shows/the-office", &show, false);
        let mut e2 = Info::new(Kind::Episode, "Two");
        (e2.season, e2.number) = (Some(1), Some(2));
        let mut e1 = Info::new(Kind::Episode, "One");
        (e1.season, e1.number) = (Some(1), Some(1));
        add(root, "shows/the-office/s01e02", &e2, true);
        add(root, "shows/the-office/s01e01", &e1, true);

        let library = scan(root).unwrap();
        let titles: Vec<_> = library.movies.iter().map(|m| m.info.title.as_str()).collect();
        assert_eq!(titles, ["Drive", "The Heat"]);
        assert_eq!(library.shows[0].1.iter().map(|e| e.info.title.as_str()).collect::<Vec<_>>(), ["One", "Two"]);
        assert_eq!(library.problems.len(), 1);
        assert!(library.find(&e1.id).is_some());
        assert_eq!(library.len(), 5);
    }

    #[test]
    fn duplicate_ids_are_reported_once() {
        let tmp = tempfile::tempdir().unwrap();
        write_marker(tmp.path()).unwrap();
        let movie = Info::new(Kind::Movie, "Copy");
        add(tmp.path(), "movies/a", &movie, true);
        add(tmp.path(), "movies/b", &movie, true);
        let library = scan(tmp.path()).unwrap();
        assert_eq!(library.movies.len(), 1);
        assert!(library.problems[0].contains("duplicate id"));
    }

    #[test]
    fn slugs_and_free_dirs() {
        assert_eq!(slug("Spirited Away (2001)"), "spirited-away-2001");
        assert_eq!(slug("¡¡"), "item");
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir(tmp.path().join("dune")).unwrap();
        assert_eq!(free_dir(tmp.path(), "Dune"), tmp.path().join("dune-2"));
    }
}
