//! Read-only enrollment status. A connection failure is never evidence of an unconfigured Mac.
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use crate::bootstrap_privileged::VerifiedSetup;
use crate::inventory::HostProfile;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Status {
    Pending,
    NotSetUp,
    Resume,
    Complete,
    Unknown,
    Unavailable,
}

impl Status {
    pub(crate) fn is_label(value: &str) -> bool {
        [
            Self::Pending,
            Self::NotSetUp,
            Self::Resume,
            Self::Complete,
            Self::Unknown,
            Self::Unavailable,
        ]
        .iter()
        .any(|status| status.label() == value)
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Pending => "Checking…",
            Self::NotSetUp => "Not set up",
            Self::Resume => "Resume setup",
            Self::Complete => "Set up",
            Self::Unknown => "Setup unknown",
            Self::Unavailable => "Couldn’t verify setup",
        }
    }
}

pub(crate) fn start(
    repository: &str,
    hosts: Vec<(String, HostProfile, bool)>,
) -> Receiver<(String, Status)> {
    let (sender, receiver) = mpsc::channel();
    if std::env::var_os("HOMELAB_NO_STATUS_CHECK").is_some() {
        for (name, _, resume) in hosts {
            let _ = sender.send((
                name,
                if resume {
                    Status::Resume
                } else {
                    Status::Unknown
                },
            ));
        }
        return receiver;
    }
    let repository = repository.to_owned();
    let _ = std::thread::Builder::new()
        .name("host-status".into())
        .spawn(move || {
            for (name, profile, resume) in hosts {
                let status = check(&repository, &name, &profile, resume);
                if sender.send((name, status)).is_err() {
                    break;
                }
            }
        });
    receiver
}

fn check(repository: &str, host: &str, profile: &HostProfile, resume: bool) -> Status {
    let fallback = if resume {
        Status::Resume
    } else {
        Status::Unavailable
    };
    let Some(root) = crate::enrollment_credentials::state_directory() else {
        return fallback;
    };
    let saved = match crate::provisioning::approved_installation(&root, host) {
        Ok(saved) => saved,
        Err(_) => return fallback,
    };
    let binding = match saved {
        Some(saved) if saved.repository == repository => {
            crate::config::setup_binding(repository, host, &saved.revision)
        }
        Some(_) => return Status::Unknown,
        None => None,
    };
    probe(
        profile,
        Path::new("/usr/bin/ssh"),
        binding.as_deref(),
        resume,
    )
    .unwrap_or(fallback)
}

fn probe(profile: &HostProfile, ssh: &Path, binding: Option<&str>, resume: bool) -> Option<Status> {
    crate::inventory::validate_profile(profile).ok()?;
    if binding.is_some_and(|value| !crate::setup_report::valid_binding(value)) {
        return None;
    }
    let helper = "/run/current-system/sw/bin/homelab-host";
    let operation = match binding {
        Some(value) => format!("{helper} read-setup-completion --binding '{value}'"),
        None => "printf '\"unknown\"'".into(),
    };
    let remote = format!("if test -x {helper}; then {operation}; else printf '\"absent\"'; fi");
    let mut command = Command::new(ssh);
    let _identity = crate::ssh_identity::configure(&mut command, profile.identity.as_ref()).ok()?;
    command
        .arg("-T")
        .args(crate::ssh::OPTIONS)
        .args([
            "-o",
            "ControlMaster=no",
            "-o",
            "ControlPath=none",
            "-o",
            "ControlPersist=no",
        ])
        .args(["-l", &profile.user, &profile.address, &remote])
        .stdin(Stdio::null());
    let output = crate::process::capture(&mut command, Duration::from_secs(6)).ok()?;
    if !output.status.success() {
        return None;
    }
    classify(&output.stdout, binding, resume)
}

fn classify(bytes: &[u8], binding: Option<&str>, resume: bool) -> Option<Status> {
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    if value == "absent" {
        return Some(if resume {
            Status::Resume
        } else {
            Status::NotSetUp
        });
    }
    if value == "unknown" {
        return Some(if resume {
            Status::Resume
        } else {
            Status::Unknown
        });
    }
    if value.is_null() {
        return Some(if resume {
            Status::Resume
        } else {
            Status::Unknown
        });
    }
    let report: VerifiedSetup = serde_json::from_value(value).ok()?;
    if report.schema == 1
        && Some(report.binding.as_str()) == binding
        && report.completed
        && report.rebooted
        && report.completed_at.is_some_and(|time| time > 0)
        && report
            .reconciled_revision
            .as_deref()
            .is_some_and(crate::config::valid_revision)
        && crate::config::valid_revision(&report.main_revision)
        && report.system.parent() == Some(Path::new("/nix/store"))
    {
        Some(Status::Complete)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn absence_and_unavailable_evidence_do_not_overwrite_saved_progress() {
        assert_eq!(
            classify(br#""absent""#, None, false),
            Some(Status::NotSetUp)
        );
        assert_eq!(classify(br#""absent""#, None, true), Some(Status::Resume));
        assert_eq!(classify(b"null", None, false), Some(Status::Unknown));
        assert_eq!(classify(b"secret remote failure", None, false), None);
    }

    #[test]
    fn completion_requires_bound_rebooted_reconciled_report() {
        let binding = "a".repeat(64);
        let mut report = json!({"schema":1,"requestId":"b".repeat(64),"binding":binding,
            "mainRevision":"c".repeat(40),"system":"/nix/store/test-system","rebooted":true,
            "completed":true,"completedAt":1,"reconciledRevision":"c".repeat(40),
            "bootSession":"00000000-0000-0000-0000-000000000001",
            "tailscale":{"addresses":["100.64.0.1"],"dns_name":"test.example"}});
        // Deserialize a valid report using the same wire shape as the installed helper.
        let expected = serde_json::to_value(crate::tailscale::VerifiedNode {
            addresses: vec!["100.64.0.1".parse().unwrap()],
            dns_name: "test.example".into(),
        })
        .unwrap();
        report["tailscale"] = expected;
        assert_eq!(
            classify(&serde_json::to_vec(&report).unwrap(), Some(&binding), true),
            Some(Status::Complete)
        );
        report["completed"] = json!(false);
        assert_eq!(
            classify(&serde_json::to_vec(&report).unwrap(), Some(&binding), true),
            None
        );
        report["completed"] = json!(true);
        assert_eq!(
            classify(
                &serde_json::to_vec(&report).unwrap(),
                Some(&"d".repeat(64)),
                true
            ),
            None
        );
    }
}
