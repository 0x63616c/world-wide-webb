//! Best-effort public release metadata, independent of setup and authentication.
use std::fs;
use std::io::Read;
use std::os::unix::fs::DirBuilderExt;
use std::path::PathBuf;
use std::sync::{Mutex, Once};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const RELEASE_URL: &str = "https://api.github.com/repos/0x63616c/homelab-cli/releases/latest";
const CACHE_SECONDS: u64 = 6 * 60 * 60;
const BODY_LIMIT: u64 = 64 * 1024;
static START: Once = Once::new();
static AVAILABLE: Mutex<Option<String>> = Mutex::new(None);

#[derive(Deserialize, Serialize)]
struct Cache {
    checked_at: u64,
    tag: Option<String>,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
}

fn version(text: &str) -> Option<[u64; 3]> {
    let text = text.strip_prefix('v').unwrap_or(text);
    let mut parts = text.split('.');
    let mut result = [0; 3];
    for part in &mut result {
        let value = parts.next()?;
        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        *part = value.parse().ok()?;
    }
    parts.next().is_none().then_some(result)
}

fn newer(current: &str, candidate: &str) -> Option<String> {
    let current = current
        .split_once("-dev(")
        .map_or(current, |(base, _)| base);
    let candidate_version = version(candidate)?;
    (candidate_version > version(current)?).then(|| {
        format!(
            "{}.{}.{}",
            candidate_version[0], candidate_version[1], candidate_version[2]
        )
    })
}

fn cache_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".homelab/cache/release.json"))
}

fn fresh(cache: &Cache, now: u64) -> bool {
    now.checked_sub(cache.checked_at)
        .is_some_and(|age| age < CACHE_SECONDS)
}

fn read_cache(path: &std::path::Path, now: u64) -> Option<Cache> {
    use rustix::fs::{Mode, OFlags, open};
    let file = fs::File::from(
        open(
            path,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .ok()?,
    );
    if !file.metadata().ok()?.is_file() {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(4097).read_to_end(&mut bytes).ok()?;
    if bytes.len() > 4096 {
        return None;
    }
    serde_json::from_slice::<Cache>(&bytes)
        .ok()
        .filter(|cache| fresh(cache, now))
}

fn fetch() -> Option<String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .https_only(true)
        .max_redirects(0)
        .timeout_global(Some(Duration::from_secs(3)))
        .build()
        .into();
    let mut response = agent
        .get(RELEASE_URL)
        .header("User-Agent", "homelab-update-check")
        .header("Accept", "application/vnd.github+json")
        .call()
        .ok()?;
    let mut bytes = Vec::new();
    response
        .body_mut()
        .as_reader()
        .take(BODY_LIMIT + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > BODY_LIMIT as usize {
        return None;
    }
    let release: Release = serde_json::from_slice(&bytes).ok()?;
    if release.draft || release.prerelease || version(&release.tag_name).is_none() {
        return None;
    }
    Some(release.tag_name)
}

/// Called only by the interactive production journey, never by fixture previews.
pub(crate) fn start() {
    if std::env::var_os("HOMELAB_NO_UPDATE_CHECK").is_some() {
        return;
    }
    START.call_once(|| {
        let _ = std::thread::Builder::new()
            .name("release-check".into())
            .spawn(|| {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                let path = cache_path();
                let cached = path.as_ref().and_then(|path| read_cache(path, now));
                let cache = cached.unwrap_or_else(|| {
                    let cache = Cache {
                        checked_at: now,
                        tag: fetch(),
                    };
                    if let Some(path) = &path
                        && let Some(parent) = path.parent()
                        && fs::DirBuilder::new()
                            .recursive(true)
                            .mode(0o700)
                            .create(parent)
                            .is_ok()
                        && let Ok(mut file) = tempfile::NamedTempFile::new_in(parent)
                        && serde_json::to_writer(file.as_file_mut(), &cache).is_ok()
                    {
                        let _ = file.persist(path);
                    }
                    cache
                });
                if let Some(tag) = cache.tag
                    && let Some(release) = newer(crate::VERSION, &tag)
                    && let Ok(mut available) = AVAILABLE.lock()
                {
                    *available = Some(release);
                }
            });
    });
}

pub(crate) fn available() -> Option<String> {
    AVAILABLE.lock().ok().and_then(|value| value.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_releases_numerically_and_handles_dev_builds() {
        assert_eq!(
            newer("0.4.0-dev(#abcd1234-dirty)", "v0.10.0"),
            Some("0.10.0".into())
        );
        assert_eq!(newer("0.4.0", "v0.4.0"), None);
        assert_eq!(newer("0.4.0", "v0.3.9"), None);
        assert_eq!(newer("0.4.0", "v0.5.0-rc.1"), None);
    }

    #[test]
    fn remote_text_cannot_become_terminal_control_sequences() {
        for invalid in ["v1.2.3\x1b[2J", "1.2.3.4", "1.2", "1.+2.3", "1.2.3\n"] {
            assert_eq!(newer("0.4.0", invalid), None);
        }
    }

    #[test]
    fn failures_are_cached_but_future_and_expired_timestamps_are_not() {
        let cache = Cache {
            checked_at: 100,
            tag: None,
        };
        assert!(fresh(&cache, 101));
        assert!(!fresh(&cache, 99));
        assert!(!fresh(&cache, 100 + CACHE_SECONDS));
    }

    #[test]
    fn cache_rejects_symlinks_directories_and_oversized_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("release.json");
        fs::write(&path, br#"{"checked_at":100,"tag":"v0.5.0"}"#).unwrap();
        assert_eq!(
            read_cache(&path, 101).unwrap().tag.as_deref(),
            Some("v0.5.0")
        );
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&path, &link).unwrap();
        assert!(read_cache(&link, 101).is_none());
        assert!(read_cache(dir.path(), 101).is_none());
        fs::write(&path, vec![b' '; 4097]).unwrap();
        assert!(read_cache(&path, 101).is_none());
    }
}
