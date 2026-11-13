use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use thiserror::Error;

use crate::process;

const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Error)]
pub enum PowerError {
    #[error(
        "Connect AC power and retry. The reported capabilities belong to another power source."
    )]
    AcPowerRequired,

    #[error(
        "macOS did not report the required AC sleep and network-wake capabilities. No settings were changed."
    )]
    MissingCapability,

    #[error("macOS returned unrecognized power settings. Inspect the host before retrying.")]
    InvalidSettings,

    #[error("The power command failed. Inspect the effective settings before retrying.")]
    CommandFailed,

    #[error(
        "The effective AC settings do not match the requested policy. Inspect the host before retrying."
    )]
    VerificationFailed,

    #[error("Battery settings changed during the operation. Inspect the host before continuing.")]
    BatteryChanged,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Outcome {
    Applied,
    AlreadyConfigured,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PowerReport {
    pub outcome: Outcome,
    pub restart_after_power_failure_supported: bool,
}

struct Settings {
    ac: BTreeMap<String, u32>,
    battery: BTreeSet<String>,
}

impl Settings {
    fn parse(output: &str) -> Result<Self, PowerError> {
        enum Source {
            Ac,
            Battery,
            Other,
        }

        let mut source = Source::Other;
        let mut ac = BTreeMap::new();
        let mut battery = BTreeSet::new();

        for line in output.lines().map(str::trim) {
            match line {
                "AC Power:" => source = Source::Ac,
                "Battery Power:" => source = Source::Battery,
                header if header.ends_with(':') => source = Source::Other,
                "" => {}
                setting => match source {
                    Source::Ac => {
                        let fields: Vec<_> = setting.split_whitespace().collect();
                        if matches!(fields.first(), Some(&"sleep" | &"womp" | &"autorestart")) {
                            if fields.len() != 2 {
                                return Err(PowerError::InvalidSettings);
                            }
                            let value =
                                fields[1].parse().map_err(|_| PowerError::InvalidSettings)?;
                            if ac.insert(fields[0].to_owned(), value).is_some() {
                                return Err(PowerError::InvalidSettings);
                            }
                        }
                    }
                    Source::Battery => {
                        battery.insert(setting.to_owned());
                    }
                    Source::Other => {}
                },
            }
        }

        if !ac.contains_key("sleep") || !ac.contains_key("womp") {
            return Err(PowerError::InvalidSettings);
        }

        Ok(Self { ac, battery })
    }

    fn matches_policy(&self, restart_supported: bool) -> bool {
        self.ac.get("sleep") == Some(&0)
            && self.ac.get("womp") == Some(&1)
            && (!restart_supported || self.ac.get("autorestart") == Some(&1))
    }
}

fn command(pmset: &Path, arguments: &[&str]) -> Result<String, PowerError> {
    let result = process::run(pmset, arguments, TIMEOUT).map_err(|_| PowerError::CommandFailed)?;
    if !result.status.success() {
        return Err(PowerError::CommandFailed);
    }
    String::from_utf8(result.stdout).map_err(|_| PowerError::InvalidSettings)
}

/// Apply the homelab's AC policy and verify it without changing battery policy.
///
/// The executable is supplied by the caller so tests exercise the same process
/// path against a fixture; the installed host command always uses /usr/bin/pmset.
pub fn configure_ac_power(pmset: &Path) -> Result<PowerReport, PowerError> {
    let capabilities = command(pmset, &["-g", "cap"])?;
    let mut lines = capabilities.lines().map(str::trim);
    if lines.next() != Some("Capabilities for AC Power:") {
        return Err(PowerError::AcPowerRequired);
    }
    let capabilities: BTreeSet<_> = lines.collect();
    if !capabilities.contains("sleep") || !capabilities.contains("womp") {
        return Err(PowerError::MissingCapability);
    }
    let restart_supported = capabilities.contains("autorestart");
    let before = Settings::parse(&command(pmset, &["-g", "custom"])?)?;
    let outcome = if before.matches_policy(restart_supported) {
        Outcome::AlreadyConfigured
    } else {
        // AC-only changes preserve a laptop's policy when its power cable is disconnected.
        let mut arguments = vec!["-c", "sleep", "0", "womp", "1"];
        if restart_supported {
            arguments.extend(["autorestart", "1"]);
        }
        command(pmset, &arguments)?;
        Outcome::Applied
    };

    let after = Settings::parse(&command(pmset, &["-g", "custom"])?)?;
    if before.battery != after.battery {
        return Err(PowerError::BatteryChanged);
    }
    if !after.matches_policy(restart_supported) {
        return Err(PowerError::VerificationFailed);
    }

    Ok(PowerReport {
        outcome,
        restart_after_power_failure_supported: restart_supported,
    })
}
