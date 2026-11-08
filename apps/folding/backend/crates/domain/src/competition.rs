use crate::{
    DomainError,
    wire::{Event, Generation, Id, MAX_SAFE_INTEGER},
};
use serde::Serialize;
use std::collections::BTreeSet;

pub const GRACE_MS: u64 = 24 * 60 * 60 * 1000;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Medal {
    Gold,
    Silver,
    Bronze,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RankedScore {
    pub participant_id: Id,
    pub folds: u64,
    pub rank: usize,
    pub percentile: Option<u8>,
    pub medal: Option<Medal>,
}

/// Input is the eligible roster's server-computed totals. Zero scorers are excluded from population.
pub fn rank_scores(scores: &[(Id, u64)]) -> Result<Vec<RankedScore>, DomainError> {
    let mut seen = BTreeSet::new();
    for (id, score) in scores {
        if !seen.insert(id) || *score > MAX_SAFE_INTEGER {
            return Err(DomainError::InvalidEnvelope);
        }
    }
    let mut positive: Vec<_> = scores.iter().filter(|(_, score)| *score > 0).collect();
    positive.sort_by(|(a_id, a), (b_id, b)| b.cmp(a).then(a_id.cmp(b_id)));
    let population = positive.len();
    let mut entries = Vec::with_capacity(population);
    let mut start = 0;
    while start < population {
        let score = positive[start].1;
        let end = start
            + positive[start..]
                .iter()
                .take_while(|(_, value)| *value == score)
                .count();
        let rank = start + 1;
        let lower = population - end;
        let percentile = if population >= 20 {
            Some(
                ((200 * lower as u128 + (population - 1) as u128) / (2 * (population - 1) as u128))
                    as u8,
            )
        } else {
            None
        };
        let medal = match rank {
            1 => Some(Medal::Gold),
            2 => Some(Medal::Silver),
            3 => Some(Medal::Bronze),
            _ => None,
        };
        for (id, folds) in &positive[start..end] {
            entries.push(RankedScore {
                participant_id: id.clone(),
                folds: *folds,
                rank,
                percentile,
                medal,
            });
        }
        start = end;
    }
    Ok(entries)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Eligibility {
    Eligible,
    Rejected(&'static str),
    Quarantined(&'static str),
}
pub struct Enrollment<'a> {
    pub device_id: &'a Id,
    pub epoch_id: &'a Id,
    pub generation: &'a Generation,
    pub issued_at_ms: u64,
}
pub fn eligibility(
    event: &Event,
    enrollment: &Enrollment<'_>,
    received_at_ms: u64,
) -> Result<Eligibility, DomainError> {
    event.validate()?;
    if received_at_ms > MAX_SAFE_INTEGER || enrollment.issued_at_ms > MAX_SAFE_INTEGER {
        return Err(DomainError::InvalidEnvelope);
    }
    if event.generation != *enrollment.generation {
        return Ok(Eligibility::Rejected("generation_stale"));
    }
    if event.device_id != *enrollment.device_id
        || event.competition_epoch_id.as_ref() != Some(enrollment.epoch_id)
    {
        return Ok(Eligibility::Rejected("epoch_stale"));
    }
    if event.is_test {
        return Ok(Eligibility::Rejected("setup_test"));
    }
    if event.observed_at_ms < enrollment.issued_at_ms {
        return Ok(Eligibility::Rejected("before_enrollment"));
    }
    if event.observed_at_ms.saturating_sub(received_at_ms) > 300_000 {
        return Ok(Eligibility::Quarantined("future_timestamp"));
    }
    Ok(Eligibility::Eligible)
}

pub fn eligible_by_receipt(received_at_ms: u64, period_end_ms: u64) -> Result<bool, DomainError> {
    if received_at_ms > MAX_SAFE_INTEGER || period_end_ms > MAX_SAFE_INTEGER {
        return Err(DomainError::InvalidEnvelope);
    }
    let cutoff = period_end_ms
        .checked_add(GRACE_MS)
        .filter(|v| *v <= MAX_SAFE_INTEGER)
        .ok_or(DomainError::Overflow)?;
    Ok(received_at_ms < cutoff)
}
