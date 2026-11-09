//! Bounded diagnostics with redacted errors; never command arguments or credentials.
use std::fs::{self, File};
use std::io::Write;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rustix::fs::{FlockOperation, Mode, OFlags, flock, open};
use serde::Serialize;

use crate::bootstrap_state::Phase;

#[derive(Serialize)]
struct Event<'a> {
    timestamp: u64,
    phase: Option<Phase>,
    code: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
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
            output: None,
            exit_code: None,
        },
    );
}

pub(crate) fn record_output(
    directory: &Path,
    code: &'static str,
    exit_code: Option<i32>,
    bytes: &[u8],
) {
    if let Err(error) = try_record_output(directory, code, exit_code, bytes) {
        eprintln!("Could not save diagnostics ({:?}).", error.kind());
    }
}

pub(crate) fn try_record_output(
    directory: &Path,
    code: &'static str,
    exit_code: Option<i32>,
    bytes: &[u8],
) -> std::io::Result<()> {
    try_record_summary(directory, code, exit_code, &SafeSummary::untrusted(bytes))
}

/// Constructors admit fixed causes and typed metadata, never arbitrary runtime strings.
pub(crate) struct SafeSummary(String);
impl SafeSummary {
    pub(crate) fn fixed(message: &'static str) -> Self {
        Self(message.into())
    }
    pub(crate) fn untrusted(bytes: &[u8]) -> Self {
        Self(redact_output(&bytes[..bytes.len().min(16 * 1024)]))
    }
    pub(crate) fn http_status(code: u16) -> Self {
        Self(format!("HTTP status {code}; response body omitted"))
    }
    pub(crate) fn io(context: &'static str, error: &std::io::Error) -> Self {
        Self(format!(
            "{context}; io_kind={:?}; os_error={:?}",
            error.kind(),
            error.raw_os_error()
        ))
    }
}

pub(crate) fn try_record_summary(
    directory: &Path,
    code: &'static str,
    exit_code: Option<i32>,
    summary: &SafeSummary,
) -> std::io::Result<()> {
    append(
        directory,
        &Event {
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            phase: None,
            code,
            output: Some(&summary.0),
            exit_code,
        },
    )
}

// External stderr is untrusted data, including remote banners and truncated key bodies.
// Persist only fixed classifications; recognizable token spelling is not a security boundary.
pub(crate) fn redact_output(bytes: &[u8]) -> String {
    let source = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    let classes = [
        (
            "host key verification failed",
            "SSH host identity verification failed",
        ),
        (
            "remote host identification has changed",
            "SSH host identity verification failed",
        ),
        ("permission denied", "permission denied"),
        ("authorization was denied", "authorization denied"),
        ("not authorized", "authorization denied"),
        ("authentication failed", "authentication failed"),
        ("publickey", "SSH key authentication failed"),
        ("cancel", "operation cancelled"),
        ("locked", "provider locked or signed out"),
        ("not signed in", "provider locked or signed out"),
        ("could not resolve", "hostname resolution failed"),
        ("name or service not known", "hostname resolution failed"),
        ("connection reset", "connection reset"),
        ("connection refused", "connection refused"),
        ("connection closed", "connection closed"),
        ("broken pipe", "connection closed"),
        ("no route to host", "network route unavailable"),
        ("network is unreachable", "network route unavailable"),
        ("timed out", "operation timed out; outcome may be unknown"),
        ("timeout", "operation timed out; outcome may be unknown"),
        (
            "repository not found",
            "repository missing or access unavailable",
        ),
        ("no such file", "required file unavailable"),
        ("not found", "required resource unavailable"),
        ("early eof", "transfer ended unexpectedly"),
        ("checkout failed", "checkout failed"),
        ("transfer failed", "transfer failed"),
        ("http status", "HTTP request failed; response body omitted"),
        (
            "response was invalid",
            "provider response invalid; contents omitted",
        ),
        (
            "output exceeded",
            "protocol output exceeded its limit; response omitted",
        ),
        (
            "execution or supervision failed",
            "process execution or supervision failed",
        ),
    ];
    let mut summaries = Vec::new();
    for (pattern, summary) in classes {
        if source.contains(pattern) && !summaries.contains(&summary) {
            summaries.push(summary);
        }
    }
    summaries.push("[REDACTED command details]");
    summaries.join("\n")
}

fn append(directory: &Path, event: &Event<'_>) -> std::io::Result<()> {
    let owner = rustix::process::geteuid().as_raw();
    let metadata = fs::symlink_metadata(directory)?;
    if !metadata.is_dir() || metadata.uid() != owner || metadata.mode() & 0o777 != 0o700 {
        return Err(std::io::Error::other("Unsafe diagnostics directory"));
    }
    let lock = File::from(open(
        directory.join("diagnostics.lock"),
        OFlags::RDWR | OFlags::CREATE | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::RUSR | Mode::WUSR,
    )?);
    let m = lock.metadata()?;
    if !m.is_file() || m.uid() != owner || m.mode() & 0o777 != 0o600 || m.nlink() != 1 {
        return Err(std::io::Error::other("Unsafe diagnostics lock"));
    }
    flock(&lock, FlockOperation::LockExclusive)?;
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
    {
        return Err(std::io::Error::other("Unsafe or full diagnostics file"));
    }
    if metadata.len() > 1024 * 1024 {
        drop(file);
        let previous = directory.join("diagnostics.previous.jsonl");
        if let Ok(m) = fs::symlink_metadata(&previous)
            && (!m.is_file() || m.uid() != owner || m.mode() & 0o777 != 0o600 || m.nlink() != 1)
        {
            return Err(std::io::Error::other("Unsafe previous diagnostics file"));
        }
        fs::rename(directory.join("diagnostics.jsonl"), previous)?;
        drop(lock);
        return append(directory, event);
    }
    let mut bytes = serde_json::to_vec(event)?;
    bytes.push(b'\n');
    file.write_all(&bytes)?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn redacts_credentials_without_discarding_failure_context() {
        // Construct synthetic delimiters so source scanners do not mistake the fixture for a key.
        let begin = format!("-----{} OPENSSH PRIVATE KEY-----", "BEGIN");
        let end = format!("-----{} OPENSSH PRIVATE KEY-----", "END");
        let input = format!(
            "fatal: connection reset\npassword=example-password\n{begin}\nexample-private-material\n{end}\nGitHub rejected ghp_examplecredential\nremote: https://user:example-password@github.com/repo\nerror: checkout failed"
        );
        let text = redact_output(input.as_bytes());
        for forbidden in [
            "example-password",
            "example-private-material",
            "ghp_examplecredential",
        ] {
            assert!(!text.contains(forbidden));
        }
        assert!(
            text.contains("connection reset")
                && text.contains("checkout failed")
                && text.contains("REDACTED")
        );
    }
    #[test]
    fn arbitrary_spaced_multiline_and_truncated_details_never_enter_diagnostics() {
        for input in [
            "remote: {\"password\" : \"SYNTHETIC_PRIVATE_VALUE\"}",
            "password = SYNTHETIC_PRIVATE_VALUE",
            "token:\nSYNTHETIC_PRIVATE_VALUE",
            "remote: SYNTHETIC_PRIVATE_VALUE",
            "SYNTHETIC_PRIVATE_VALUE\n-----END OPENSSH PRIVATE KEY-----",
            "connection reset: SYNTHETIC_PRIVATE_VALUE",
        ] {
            let summary = redact_output(input.as_bytes());
            assert!(!summary.contains("SYNTHETIC_PRIVATE_VALUE"));
            assert!(!summary.contains("PRIVATE KEY"));
            assert!(summary.contains("REDACTED"));
        }
    }
    #[test]
    fn preserves_exit_and_event_when_error_contains_a_token() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        try_record_output(
            root.path(),
            "git-clone",
            Some(128),
            b"fatal: transfer failed; tskey-secret-value",
        )
        .unwrap();
        let text = fs::read_to_string(root.path().join("diagnostics.jsonl")).unwrap();
        assert!(
            text.contains("git-clone") && text.contains("128") && text.contains("transfer failed")
        );
        assert!(!text.contains("tskey-secret-value"));
    }
}
