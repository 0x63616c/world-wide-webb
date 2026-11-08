//! Typed, deliberately explicit admission policy. No credential values belong here.
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

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
    pub admission_enabled: bool,
    pub repositories: Vec<RepositoryConfig>,
    pub image: String,
    pub cpu: u16,
    pub memory_mib: u32,
    pub admission_free_bytes: u64,
    pub emergency_free_bytes: u64,
    pub deadlines: Deadlines,
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if !valid_image_digest(&self.image) {
            return Err("image must be pinned by a sha256 OCI digest".into());
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
