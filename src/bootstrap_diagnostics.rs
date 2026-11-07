//! Bounded diagnostic events; never child output, command arguments or credentials.
use std::fs::{self, File};
use std::io::Write;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rustix::fs::{Mode, OFlags, open};
use serde::Serialize;

use crate::bootstrap_state::Phase;

#[derive(Serialize)]
struct Event<'a> {
    timestamp: u64,
    phase: Option<Phase>,
    code: &'a str,
}

pub(crate) fn record(directory: &Path, phase: Option<Phase>, code: &'static str) {
    let _ = append(
        directory,
        &Event {
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            phase,
            code,
        },
    );
}

fn append(directory: &Path, event: &Event<'_>) -> std::io::Result<()> {
    let owner = rustix::process::geteuid().as_raw();
    let metadata = fs::symlink_metadata(directory)?;
    if !metadata.is_dir() || metadata.uid() != owner || metadata.mode() & 0o777 != 0o700 {
        return Err(std::io::Error::other("Unsafe diagnostics directory"));
    }
    let mut file = File::from(open(
        directory.join("diagnostics.jsonl"),
        OFlags::WRONLY
            | OFlags::CREATE
            | OFlags::APPEND
            | OFlags::NOFOLLOW
            | OFlags::NONBLOCK
            | OFlags::CLOEXEC,
        Mode::RUSR | Mode::WUSR,
    )?);
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.uid() != owner
        || metadata.mode() & 0o777 != 0o600
        || metadata.nlink() != 1
        || metadata.len() > 64 * 1024
    {
        return Err(std::io::Error::other("Unsafe or full diagnostics file"));
    }
    let mut bytes = serde_json::to_vec(event)?;
    bytes.push(b'\n');
    file.write_all(&bytes)?;
    file.sync_all()
}
