//! Typed, deliberately explicit admission policy. No credential values belong here.
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// Per-host macOS guest limit enforced by Apple's virtualization platform.
pub const MAX_MACOS_GUESTS: usize = 2;
pub const MAX_CONCURRENT_JOBS: usize = 4;

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Platform {
    #[default]
    MacosArm64,
    LinuxArm64,
}
impl Platform {
    pub fn labels(self) -> [&'static str; 4] {
        match self {
            Self::MacosArm64 => ["self-hosted", "macOS", "ARM64", "homelab-tart"],
            Self::LinuxArm64 => ["self-hosted", "Linux", "ARM64", "homelab-linux"],
        }
    }
    pub fn resolve(labels: &[String]) -> Option<Self> {
        [Self::MacosArm64, Self::LinuxArm64]
            .into_iter()
            .find(|platform| {
                let approved = platform.labels();
                labels
                    .iter()
                    .any(|label| label.eq_ignore_ascii_case(approved[3]))
                    && labels
                        .iter()
                        .all(|label| approved.iter().any(|v| label.eq_ignore_ascii_case(v)))
            })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LinuxProfile {
    pub image: String,
    pub cpu: u16,
    pub memory_mib: u32,
    pub disk_growth_bytes: u64,
    /// All runnable workflows must use explicit routing before mixing platforms.
    pub routing_audit_approved: bool,
    pub runner_archive: std::path::PathBuf,
    pub runner_version: String,
}
fn default_cpu_budget() -> u16 {
    12
}
fn default_memory_budget() -> u32 {
    24576
}
fn default_mac_limit() -> usize {
    MAX_MACOS_GUESTS
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RepositoryConfig {
    pub owner: String,
    pub name: String,
    pub repository_id: u64,
    pub installation_id: u64,
    pub runner_group_id: u64,
    pub trust_approved: bool,
}
impl RepositoryConfig {
    pub fn key(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Deadlines {
    pub boot_seconds: u64,
    pub unassigned_seconds: u64,
    pub running_seconds: u64,
    pub retry_seconds: u64,
}
impl Default for Deadlines {
    fn default() -> Self {
        Self {
            boot_seconds: 600,
            unassigned_seconds: 300,
            running_seconds: 7200,
            retry_seconds: 30,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub host_name: String,
    pub admission_enabled: bool,
    #[serde(default = "one_job")]
    pub max_concurrent_jobs: usize,
    #[serde(default = "default_mac_limit")]
    pub max_macos_guests: usize,
    #[serde(default = "default_cpu_budget")]
    pub cpu_budget: u16,
    #[serde(default = "default_memory_budget")]
    pub memory_budget_mib: u32,
    #[serde(default)]
    pub linux: Option<LinuxProfile>,
    pub repositories: Vec<RepositoryConfig>,
    pub image: String,
    pub cpu: u16,
    pub memory_mib: u32,
    pub admission_free_bytes: u64,
    pub emergency_free_bytes: u64,
    pub deadlines: Deadlines,
}
fn one_job() -> usize {
    1
}

impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if !crate::names::valid_host(&self.host_name) {
            return Err(
                "runner host name must be a lowercase DNS label of at most 26 characters".into(),
            );
        }
        if !valid_image_digest(&self.image) {
            return Err("image must be pinned by a sha256 OCI digest".into());
        }
        if !(1..=MAX_CONCURRENT_JOBS).contains(&self.max_concurrent_jobs)
            || !(1..=MAX_MACOS_GUESTS).contains(&self.max_macos_guests)
            || self.cpu_budget == 0
            || self.memory_budget_mib == 0
        {
            return Err("invalid total, macOS or resource capacity".into());
        }
        if let Some(linux) = &self.linux
            && (!valid_image_digest(&linux.image)
                || !linux.routing_audit_approved
                || !(1..=8).contains(&linux.cpu)
                || !(1024..=16384).contains(&linux.memory_mib)
                || linux.disk_growth_bytes == 0
                || !linux.runner_archive.is_absolute()
                || !valid_runner_version(&linux.runner_version))
        {
            return Err("invalid or unaudited Linux profile".into());
        }
        if !(1..=8).contains(&self.cpu)
            || !(1024..=16384).contains(&self.memory_mib)
            || self.emergency_free_bytes == 0
            || self.admission_free_bytes <= self.emergency_free_bytes
        {
            return Err("invalid resources or storage thresholds".into());
        }
        if [
            self.deadlines.boot_seconds,
            self.deadlines.unassigned_seconds,
            self.deadlines.running_seconds,
            self.deadlines.retry_seconds,
        ]
        .contains(&0)
        {
            return Err("deadlines must be positive".into());
        }
        let mut keys = BTreeSet::new();
        let mut ids = BTreeSet::new();
        for repo in &self.repositories {
            let valid = |s: &str| {
                !s.is_empty()
                    && s.len() <= 100
                    && s != "."
                    && s != ".."
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
            };
            if !valid(&repo.owner)
                || !valid(&repo.name)
                || repo.repository_id == 0
                || repo.installation_id == 0
                || repo.runner_group_id == 0
            {
                return Err("invalid repository identity".into());
            }
            if !keys.insert(repo.key().to_ascii_lowercase()) || !ids.insert(repo.repository_id) {
                return Err("duplicate repository".into());
            }
        }
        Ok(())
    }
}

pub fn valid_image_digest(image: &str) -> bool {
    let Some((reference, digest)) = image.split_once("@sha256:") else {
        return false;
    };
    !reference.is_empty()
        && !reference.starts_with('-')
        && reference
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"./:_-".contains(&c))
        && digest.len() == 64
        && digest
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

pub fn valid_runner_version(version: &str) -> bool {
    let parts = version.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.len() <= 5
                && part.bytes().all(|b| b.is_ascii_digit())
                && part.parse::<u16>().is_ok()
        })
        && parts[0].parse::<u16>().is_ok_and(|major| major > 0)
}
