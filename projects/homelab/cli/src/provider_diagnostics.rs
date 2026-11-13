//! Operator metadata diagnostics. Never record argv, environment, stdin or stdout.
use crate::bootstrap_diagnostics::SafeSummary;
use crate::process::ProcessError;
use std::{
    fs, io,
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    process::Output,
    sync::Mutex,
};

static DIRECTORY: Mutex<Option<PathBuf>> = Mutex::new(None);
static WRITE_FAILED: Mutex<bool> = Mutex::new(false);

#[derive(Clone, Copy)]
pub(crate) enum Operation {
    OpVault,
    OpList,
    OpRead,
    OpCreate,
    OpEdit,
    GitHubRead,
    GitHubWrite,
    GitRead,
    SshCheck,
    SshInspect,
    SshVerify,
    SshStage,
    SshGitIdentity,
    SshCleanup,
    ScpTransfer,
    TailscaleToken,
    TailscaleCreate,
    TailscaleRevoke,
}
impl Operation {
    fn label(self) -> &'static str {
        match self {
            Self::OpVault => "provider-op-vault",
            Self::OpList => "provider-op-item-list",
            Self::OpRead => "provider-op-item-read",
            Self::OpCreate => "provider-op-item-create",
            Self::OpEdit => "provider-op-item-edit",
            Self::GitHubRead => "provider-github-read",
            Self::GitHubWrite => "provider-github-write",
            Self::GitRead => "transport-git-read",
            Self::SshCheck => "transport-ssh-check",
            Self::SshInspect => "transport-ssh-inspect",
            Self::SshVerify => "transport-ssh-verify",
            Self::SshStage => "transport-ssh-stage",
            Self::SshGitIdentity => "transport-ssh-git-identity",
            Self::SshCleanup => "transport-ssh-cleanup",
            Self::ScpTransfer => "transport-scp-transfer",
            Self::TailscaleToken => "provider-tailscale-token",
            Self::TailscaleCreate => "provider-tailscale-create",
            Self::TailscaleRevoke => "provider-tailscale-revoke",
        }
    }
    fn secret_output(self) -> bool {
        matches!(
            self,
            Self::OpVault | Self::OpList | Self::OpRead | Self::OpCreate | Self::OpEdit
        )
    }
}

/// Call once before configuration/provider work. Failure must be shown to the user.
pub fn initialize() -> io::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .ok_or_else(|| io::Error::other("HOME is unavailable for diagnostics"))?;
    let home = PathBuf::from(home).canonicalize()?;
    let mut root = home;
    for component in [
        ".homelab",
        "logs",
        crate::operator_profile::name().unwrap_or("default"),
    ] {
        root.push(component);
        private_directory(&root)?;
    }
    let file = root.join("diagnostics.jsonl");
    let opened = fs::OpenOptions::new()
        .append(true)
        .create(true)
        .mode(0o600)
        .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32)
        .open(&file)?;
    let m = opened.metadata()?;
    if !m.is_file()
        || m.uid() != rustix::process::geteuid().as_raw()
        || m.mode() & 0o777 != 0o600
        || m.nlink() != 1
    {
        return Err(io::Error::other("Unsafe operator diagnostics file"));
    }
    *DIRECTORY.lock().unwrap() = Some(root);
    *WRITE_FAILED.lock().unwrap() = false;
    Ok(file)
}
fn private_directory(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(_) => (),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            fs::DirBuilder::new().mode(0o700).create(path)?;
        }
        Err(e) => return Err(e),
    }
    let m = fs::symlink_metadata(path)?;
    if !m.is_dir() || m.uid() != rustix::process::geteuid().as_raw() || m.mode() & 0o777 != 0o700 {
        return Err(io::Error::other(
            "Operator diagnostics directory must be private and not a symlink",
        ));
    }
    Ok(())
}
pub fn path() -> Option<PathBuf> {
    DIRECTORY
        .lock()
        .unwrap()
        .as_ref()
        .map(|p| p.join("diagnostics.jsonl"))
}
pub fn write_failed() -> bool {
    *WRITE_FAILED.lock().unwrap()
}

pub(crate) fn op(arguments: &[&str]) -> Operation {
    match arguments {
        ["vault", ..] => Operation::OpVault,
        ["item", "list", ..] => Operation::OpList,
        ["item", "create", ..] => Operation::OpCreate,
        ["item", "edit", ..] => Operation::OpEdit,
        _ => Operation::OpRead,
    }
}
fn op_cause(stderr: &[u8]) -> &'static str {
    let text = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    if text.contains("denied") || text.contains("not authorized") {
        "1Password authorization was denied"
    } else if text.contains("cancel") {
        "1Password authorization was cancelled"
    } else if text.contains("locked") || text.contains("not signed in") {
        "1Password is locked or signed out"
    } else if text.contains("not found") || text.contains("isn't an item") {
        "1Password item or vault was not found"
    } else if text.contains("permission") || text.contains("access") {
        "1Password access was unavailable"
    } else {
        "1Password returned an unrecognized error; sensitive response omitted"
    }
}
fn record_at(
    directory: &Path,
    operation: Operation,
    exit: Option<i32>,
    summary: &SafeSummary,
) -> io::Result<()> {
    private_directory(directory)?;
    crate::bootstrap_diagnostics::try_record_summary(directory, operation.label(), exit, summary)
}
fn record(operation: Operation, exit: Option<i32>, summary: SafeSummary) {
    let directory = DIRECTORY.lock().unwrap().clone();
    if let Some(directory) = directory
        && record_at(&directory, operation, exit, &summary).is_err()
    {
        let mut failed = WRITE_FAILED.lock().unwrap();
        if !*failed {
            eprintln!("Could not save diagnostic log.");
        }
        *failed = true;
    }
}
pub(crate) fn observe(
    operation: Operation,
    result: Result<Output, ProcessError>,
) -> Result<Output, ProcessError> {
    match &result {
        Ok(output) if !output.status.success() => {
            let summary = if operation.secret_output() {
                SafeSummary::fixed(op_cause(&output.stderr))
            } else {
                SafeSummary::untrusted(&output.stderr)
            };
            record(operation, output.status.code(), summary);
        }
        Err(error) => {
            let cause = match error {
                ProcessError::Io(error) => {
                    SafeSummary::io("execution or supervision failed", error)
                }
                ProcessError::Timeout => {
                    SafeSummary::fixed("operation timed out; outcome may be unknown")
                }
                ProcessError::ExcessiveOutput => {
                    SafeSummary::fixed("protocol output exceeded its limit; response omitted")
                }
            };
            record(operation, None, cause);
        }
        _ => (),
    }
    result
}
pub(crate) fn invalid_response(operation: Operation) {
    record(
        operation,
        Some(0),
        SafeSummary::fixed("provider response was invalid; contents omitted"),
    );
}
pub(crate) fn http(operation: Operation, error: &ureq::Error) {
    let summary = match error {
        ureq::Error::StatusCode(code) => SafeSummary::http_status(*code),
        ureq::Error::Timeout(_) => {
            SafeSummary::fixed("HTTP request timed out; outcome may be unknown")
        }
        ureq::Error::HostNotFound => SafeSummary::fixed("HTTP hostname resolution failed"),
        ureq::Error::Io(error) => SafeSummary::io("HTTP transport failed", error),
        _ => SafeSummary::fixed("HTTP transport or protocol failed; response body omitted"),
    };
    record(operation, None, summary);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sensitive_op_errors_are_classified_without_persisting_values() {
        let root = tempfile::tempdir().unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let error =
            b"authorization denied {\"password\":\"synthetic-secret\",\"token\":\"ghp_synthetic\"}";
        record_at(
            root.path(),
            Operation::OpRead,
            Some(1),
            &SafeSummary::fixed(op_cause(error)),
        )
        .unwrap();
        let text = fs::read_to_string(root.path().join("diagnostics.jsonl")).unwrap();
        assert!(
            text.contains("provider-op-item-read")
                && text.contains("denied")
                && text.contains("exit_code")
        );
        assert!(!text.contains("synthetic-secret") && !text.contains("ghp_synthetic"));
    }
    #[test]
    fn typed_status_and_io_metadata_survive_without_untrusted_error_text() {
        let root = tempfile::tempdir().unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        record_at(
            root.path(),
            Operation::TailscaleCreate,
            None,
            &SafeSummary::http_status(429),
        )
        .unwrap();
        let error = io::Error::new(io::ErrorKind::ConnectionRefused, "SYNTHETIC_PRIVATE_VALUE");
        record_at(
            root.path(),
            Operation::SshCheck,
            None,
            &SafeSummary::io("execution failed", &error),
        )
        .unwrap();
        let text = fs::read_to_string(root.path().join("diagnostics.jsonl")).unwrap();
        assert!(
            text.contains("HTTP status 429")
                && text.contains("ConnectionRefused")
                && text.contains("os_error")
        );
        assert!(!text.contains("SYNTHETIC_PRIVATE_VALUE"));
    }
    #[test]
    fn directory_links_and_public_directories_are_rejected() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let root = tempfile::tempdir().unwrap();
        let public = root.path().join("public");
        fs::create_dir(&public).unwrap();
        fs::set_permissions(&public, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(private_directory(&public).is_err());
        let link = root.path().join("link");
        symlink(root.path(), &link).unwrap();
        assert!(private_directory(&link).is_err());
    }
}
