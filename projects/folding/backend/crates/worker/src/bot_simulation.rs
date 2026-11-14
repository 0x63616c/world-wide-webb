//! Deterministic bot planning primitives. Bot event persistence is deliberately server-only;
//! public DTOs do not include this module's types.
use serde::Deserialize;
use sha2::{Digest, Sha256};

pub const LAUNCH_BOT_COUNT: usize = 50;
pub const WEEKLY_JOIN_COUNT: usize = 2;
pub const MAX_BOT_COUNT: usize = 150;

#[derive(Clone, Debug, Deserialize)]
pub struct Persona {
    pub id: String,
    pub version: u32,
    pub timezone: String,
    pub wake_hour: u8,
    pub sleep_hour: u8,
    pub usage: Usage,
    pub weekday_folds: u8,
    pub weekend_folds: u8,
    pub skipped_day_percent: u8,
    pub churn_percent: u8,
    pub nickname_style: String,
    pub avatar_style: String,
    pub session_rhythm: String,
    pub jitter_minutes: u8,
    pub join_days_ago: u16,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Usage {
    Light,
    Medium,
    Heavy,
}

pub fn personas() -> Vec<Persona> {
    serde_json::from_str(include_str!("../personas-v1.json"))
        .expect("bundled persona data is valid")
}

/// Returns the highest safe bot score. Empty human boards conservatively permit no bot score.
pub fn score_ceiling(top_real_score: Option<u64>) -> u64 {
    top_real_score.map_or(0, |score| score.saturating_sub(1))
}

/// A bot may publish only if its resulting score is strictly below the current top real score.
pub fn may_publish(
    current_bot_score: u64,
    proposed_bot_score: u64,
    top_real_score: Option<u64>,
) -> bool {
    proposed_bot_score >= current_bot_score && proposed_bot_score <= score_ceiling(top_real_score)
}

/// Domain-separated deterministic identifier material for bot identities. This value is never
/// derived from an Apple subject and can be checked against the globally unique participant key.
pub fn subject_hmac(seed: &[u8; 32], ordinal: u64) -> String {
    let mut hash = Sha256::new();
    hash.update(b"folding.bot.subject.v1\0");
    hash.update(seed);
    hash.update(ordinal.to_be_bytes());
    format!("bot:v1:{}", crate::assertion::hex(&hash.finalize()))
}

pub fn day_seed(seed: &[u8; 32], day: i64) -> u64 {
    let mut hash = Sha256::new();
    hash.update(b"folding.bot.day.v1\0");
    hash.update(seed);
    hash.update(day.to_be_bytes());
    u64::from_be_bytes(hash.finalize()[..8].try_into().expect("fixed digest"))
}

pub fn bot_score_allowed(current: u64, proposed: u64, real_top: Option<u64>) -> bool {
    may_publish(current, proposed, real_top)
}

/// Plan local-day fold count and minute offsets for deterministic open/close observations.
/// The seed supplied here must be derived from the stored bot seed and local date.
pub fn day_plan(persona: &Persona, seed: u64, weekend: bool) -> Vec<u16> {
    let mut rng = DayRandom::new(seed);
    if rng.below(100) < u64::from(persona.skipped_day_percent) {
        return Vec::new();
    }
    let nominal = if weekend {
        persona.weekend_folds
    } else {
        persona.weekday_folds
    };
    let count = match persona.usage {
        Usage::Light => nominal.saturating_sub((rng.below(4) as u8).min(nominal)),
        Usage::Medium => nominal.saturating_sub(4).saturating_add(rng.below(9) as u8),
        Usage::Heavy => nominal
            .saturating_sub(10)
            .saturating_add(rng.below(21) as u8),
    };
    let start = u16::from(persona.wake_hour) * 60;
    // sleep_hour may extend into the next day for late-night personas.
    let end = u16::from(persona.sleep_hour) * 60;
    if end <= start || count == 0 {
        return Vec::new();
    }
    let span = end - start;
    let mut times = Vec::with_capacity(count as usize * 2);
    let mut previous = start;
    for index in 0..count {
        if previous >= end - 1 {
            break;
        }
        let base = start + (u32::from(span) * u32::from(index) / u32::from(count)) as u16;
        let jitter = u16::from(persona.jitter_minutes);
        let offset = if jitter == 0 {
            0
        } else {
            rng.below(u64::from(jitter * 2 + 1)) as i32 - i32::from(jitter)
        };
        let open = (i32::from(base) + offset).clamp(i32::from(previous), i32::from(end - 2)) as u16;
        let duration = 8 + rng.below(48) as u16;
        let close = (open + duration).min(end - 1);
        times.push(open);
        times.push(close);
        previous = close.saturating_add(1);
    }
    times
}

/// Stable SplitMix64 stream, seeded independently for each bot/day. No process-global RNG state.
#[derive(Clone, Copy)]
pub struct DayRandom(u64);
impl DayRandom {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }
    pub fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }
    pub fn below(&mut self, upper: u64) -> u64 {
        if upper == 0 { 0 } else { self.next() % upper }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bot_stays_strictly_under_human_leader_including_ties_and_quiet_leader() {
        for top in [1, 7, 42, u64::MAX] {
            let cap = score_ceiling(Some(top));
            assert!(cap < top);
            assert!(may_publish(0, cap, Some(top)));
            assert!(!may_publish(0, top, Some(top)));
        }
    }
    #[test]
    fn empty_human_board_is_zero_and_never_competitive() {
        assert_eq!(score_ceiling(None), 0);
        assert!(may_publish(0, 0, None));
        assert!(!may_publish(0, 1, None));
    }
    #[test]
    fn a_bot_cannot_reduce_or_publish_above_its_cap() {
        assert!(!may_publish(5, 4, Some(10)));
        assert!(!may_publish(5, 9, Some(9)));
        assert!(may_publish(5, 8, Some(9)));
    }
    #[test]
    fn daily_activity_is_seeded_and_stays_within_persona_window() {
        let persona = personas()
            .into_iter()
            .find(|p| p.id == "commuter-medium")
            .unwrap();
        let first = day_plan(&persona, 901, false);
        assert_eq!(first, day_plan(&persona, 901, false));
        assert!(first.len() % 2 == 0);
        assert!(
            first
                .iter()
                .all(|minute| *minute >= u16::from(persona.wake_hour) * 60
                    && *minute <= u16::from(persona.sleep_hour) * 60)
        );
    }
    #[test]
    fn random_stream_is_reproducible_and_personas_versioned() {
        let mut a = DayRandom::new(123);
        let mut b = DayRandom::new(123);
        assert_eq!(
            (0..32).map(|_| a.next()).collect::<Vec<_>>(),
            (0..32).map(|_| b.next()).collect::<Vec<_>>()
        );
        assert!(
            personas()
                .iter()
                .all(|p| p.version > 0 && p.wake_hour < p.sleep_hour)
        );
    }

    #[test]
    fn domain_separated_bot_subjects_are_unique_and_not_human_subjects() {
        let seed = [42; 32];
        let values: std::collections::BTreeSet<_> = (0..MAX_BOT_COUNT as u64)
            .map(|n| subject_hmac(&seed, n))
            .collect();
        assert_eq!(values.len(), MAX_BOT_COUNT);
        assert!(values.iter().all(|v| v.starts_with("bot:v1:")));
        assert_ne!(
            subject_hmac(&seed, 1),
            format!("{}", crate::assertion::hex(&seed))
        );
    }

    #[test]
    fn score_cap_handles_ties_empty_boards_and_inactive_leaders() {
        assert!(!bot_score_allowed(4, 10, Some(10)));
        assert!(bot_score_allowed(4, 9, Some(10)));
        assert!(!bot_score_allowed(0, 1, None));
        // An inactive leader is still the real score ceiling: never pass it.
        assert!(!bot_score_allowed(4, 11, Some(11)));
    }
}
