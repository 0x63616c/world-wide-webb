//! Profile rewards derived exclusively from authoritative counted competition folds.
//! The public projection deliberately contains neither progress nor earned timestamps.
use crate::{DomainError, wire::MAX_SAFE_INTEGER};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub const CATALOG_VERSION: u32 = 1;
pub const UTC_DAY_MS: u64 = 86_400_000;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum BadgeId {
    #[serde(rename = "folds_1")]
    Folds1,
    #[serde(rename = "folds_100")]
    Folds100,
    #[serde(rename = "folds_1000")]
    Folds1000,
    #[serde(rename = "folds_10000")]
    Folds10000,
    #[serde(rename = "days_7")]
    Days7,
    #[serde(rename = "days_30")]
    Days30,
}

impl BadgeId {
    pub const ALL: [Self; 6] = [
        Self::Folds1,
        Self::Folds100,
        Self::Folds1000,
        Self::Folds10000,
        Self::Days7,
        Self::Days30,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Folds1 => "folds_1",
            Self::Folds100 => "folds_100",
            Self::Folds1000 => "folds_1000",
            Self::Folds10000 => "folds_10000",
            Self::Days7 => "days_7",
            Self::Days30 => "days_30",
        }
    }

    pub fn track(self) -> Track {
        match self {
            Self::Folds1 | Self::Folds100 | Self::Folds1000 | Self::Folds10000 => Track::Folds,
            Self::Days7 | Self::Days30 => Track::Days,
        }
    }

    pub fn threshold(self) -> u64 {
        match self {
            Self::Folds1 => 1,
            Self::Folds100 => 100,
            Self::Folds1000 => 1_000,
            Self::Folds10000 => 10_000,
            Self::Days7 => 7,
            Self::Days30 => 30,
        }
    }
}

// Explicit names preserve the catalog's wire IDs, independently of Rust case conversion.
impl std::fmt::Display for BadgeId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Track {
    Folds,
    Days,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct NextMilestone {
    pub track: Track,
    pub badge_id: BadgeId,
    pub current: u64,
    pub target: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Progress {
    pub catalog_version: u32,
    pub folds: u64,
    pub days_used: u64,
    /// At most one target per track; no locked future catalog is serialized.
    pub next: Vec<NextMilestone>,
    pub earned: Vec<BadgeId>,
}

pub fn progress(folds: u64, days_used: u64) -> Result<Progress, DomainError> {
    if folds > MAX_SAFE_INTEGER || days_used > folds || (folds > 0 && days_used == 0) {
        return Err(DomainError::InvalidEnvelope);
    }
    let mut earned = Vec::new();
    let mut next = Vec::new();
    for track in [Track::Folds, Track::Days] {
        let current = match track {
            Track::Folds => folds,
            Track::Days => days_used,
        };
        for badge in BadgeId::ALL
            .into_iter()
            .filter(|badge| badge.track() == track)
        {
            if current >= badge.threshold() {
                earned.push(badge);
            } else {
                next.push(NextMilestone {
                    track,
                    badge_id: badge,
                    current,
                    target: badge.threshold(),
                });
                break;
            }
        }
    }
    Ok(Progress {
        catalog_version: CATALOG_VERSION,
        folds,
        days_used,
        next,
        earned,
    })
}

/// Bounded replay/backfill helper. Callers supply reducer-counted timestamps, never
/// raw observations or client totals. Equal timestamps may represent distinct folds.
pub fn from_counted_timestamps(timestamps: &[u64]) -> Result<Progress, DomainError> {
    if timestamps.iter().any(|value| *value > MAX_SAFE_INTEGER) {
        return Err(DomainError::InvalidEnvelope);
    }
    let days: BTreeSet<_> = timestamps.iter().map(|time| time / UTC_DAY_MS).collect();
    progress(timestamps.len() as u64, days.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_only_the_next_target_and_keeps_earlier_awards() {
        let initial = progress(0, 0).unwrap();
        assert!(initial.earned.is_empty());
        assert_eq!(
            initial.next.iter().map(|n| n.target).collect::<Vec<_>>(),
            [1, 7]
        );
        let middle = progress(640, 6).unwrap();
        assert_eq!(middle.earned, [BadgeId::Folds1, BadgeId::Folds100]);
        assert_eq!(middle.next[0].target, 1_000);
        assert_eq!(middle.next[0].current, 640);
        let wire = serde_json::to_string(&middle).unwrap();
        assert!(!wire.contains("10000") && !wire.contains("days_30"));
        let reached = progress(1_000, 7).unwrap();
        assert_eq!(
            reached.next.iter().map(|n| n.target).collect::<Vec<_>>(),
            [10_000, 30]
        );
        assert!(reached.earned.contains(&BadgeId::Folds1000));
        assert!(reached.earned.contains(&BadgeId::Days7));
    }

    #[test]
    fn every_threshold_is_inclusive_and_completed_tracks_have_no_fake_target() {
        for (folds, days, awards) in [
            (1, 1, 1),
            (99, 1, 1),
            (100, 1, 2),
            (999, 1, 2),
            (1_000, 1, 3),
            (9_999, 29, 4),
            (10_000, 30, 6),
        ] {
            assert_eq!(progress(folds, days).unwrap().earned.len(), awards);
        }
        let complete = progress(10_000, 30).unwrap();
        assert!(complete.next.is_empty());
        assert_eq!(complete.earned, BadgeId::ALL);
    }

    #[test]
    fn counts_distinct_utc_days_without_a_consecutive_day_requirement() {
        let timestamps = [
            UTC_DAY_MS - 1,
            UTC_DAY_MS,
            UTC_DAY_MS,
            3 * UTC_DAY_MS,
            8 * UTC_DAY_MS,
            20 * UTC_DAY_MS,
            40 * UTC_DAY_MS,
            60 * UTC_DAY_MS,
        ];
        let result = from_counted_timestamps(&timestamps).unwrap();
        assert_eq!(result.folds, 8);
        assert_eq!(result.days_used, 7);
        assert!(result.earned.contains(&BadgeId::Days7));
    }

    #[test]
    fn corrected_totals_revoke_only_thresholds_no_longer_reached() {
        let before = progress(1_000, 30).unwrap();
        let after = progress(999, 29).unwrap();
        assert!(before.earned.contains(&BadgeId::Folds1000));
        assert!(!after.earned.contains(&BadgeId::Folds1000));
        assert!(!after.earned.contains(&BadgeId::Days30));
        assert!(after.earned.contains(&BadgeId::Folds100));
        assert!(after.earned.contains(&BadgeId::Days7));
    }

    #[test]
    fn rejects_impossible_or_unsafe_authoritative_aggregates() {
        for (folds, days) in [(0, 1), (1, 2), (1, 0), (MAX_SAFE_INTEGER + 1, 1)] {
            assert_eq!(progress(folds, days), Err(DomainError::InvalidEnvelope));
        }
        assert!(from_counted_timestamps(&[MAX_SAFE_INTEGER + 1]).is_err());
    }

    #[test]
    fn catalog_wire_ids_are_stable_and_unknown_values_are_rejected() {
        for badge in BadgeId::ALL {
            let json = format!("\"{}\"", badge.as_str());
            assert_eq!(serde_json::to_string(&badge).unwrap(), json);
            assert_eq!(serde_json::from_str::<BadgeId>(&json).unwrap(), badge);
        }
        assert!(serde_json::from_str::<BadgeId>("\"folds_999\"").is_err());
    }
}
