//! Profiles isolate operator state without changing HOME or external authentication.
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static ACTIVE: OnceLock<Option<String>> = OnceLock::new();

pub fn parse_name(value: &str) -> Result<String, String> {
    if value.is_empty()
        || value.len() > 32
        || !value.as_bytes()[0].is_ascii_lowercase()
        || !value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        })
    {
        return Err(
            "Use 1–32 lowercase letters, digits, hyphens or underscores, starting with a letter."
                .into(),
        );
    }
    Ok(value.to_owned())
}

pub fn select(name: Option<String>) -> Result<(), &'static str> {
    let name = name.filter(|value| value != "default");
    if name
        .as_deref()
        .is_some_and(|value| parse_name(value).is_err())
    {
        return Err("Invalid profile name.");
    }
    ACTIVE.set(name).map_err(|_| "Profile already selected.")
}

pub fn name() -> Option<&'static str> {
    ACTIVE.get().and_then(|name| name.as_deref())
}

fn directory(home: &Path, name: Option<&str>) -> PathBuf {
    home.join(".homelab/profiles")
        .join(name.unwrap_or("default"))
}

pub fn inventory_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| directory(Path::new(&home), name()).join("inventory.json"))
}

pub fn provisioning_directory() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| directory(Path::new(&home), name()).join("provisioning"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_cannot_escape_profile_directory() {
        for bad in [
            "",
            "..",
            "../default",
            "/tmp/demo",
            "a/b",
            "a\\b",
            "-demo",
            "Demo",
            "a\n",
            &"a".repeat(33),
        ] {
            assert!(parse_name(bad).is_err());
        }
        for good in ["demo", "test-2", "my_lab", "default"] {
            assert!(parse_name(good).is_ok());
        }
    }
    #[test]
    fn profiles_share_one_root() {
        let home = Path::new("/example");
        assert_eq!(
            directory(home, None),
            home.join(".homelab/profiles/default")
        );
        assert_eq!(
            directory(home, Some("demo")),
            home.join(".homelab/profiles/demo")
        );
    }
}
