use crate::{
    DomainError,
    wire::{Event, Generation, Id, Interruption, Transition},
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Completeness {
    Complete,
    Candidate,
    Incomplete,
    Running,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Session {
    pub device_id: Id,
    pub generation: Generation,
    pub start_ms: u64,
    pub end_ms: Option<u64>,
    pub duration_ms: Option<u64>,
    pub completeness: Completeness,
    pub opening_event_id: Id,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Summary {
    pub opens: u64,
    pub closes: u64,
    pub cycles: u64,
    pub complete_duration_ms: u64,
    pub sessions: Vec<Session>,
    /// Counted transitions retain event IDs for server-owned period assignment after full replay.
    pub counted_events: Vec<Id>,
}
impl Summary {
    pub fn folds(&self) -> u64 {
        self.opens + self.closes
    }
    pub fn incomplete_sessions(&self) -> usize {
        self.sessions
            .iter()
            .filter(|s| s.completeness == Completeness::Incomplete)
            .count()
    }
}
#[derive(Clone)]
struct Active {
    start: u64,
    candidate: bool,
    opening_event_id: Id,
}
fn finish(
    active: &mut Option<Active>,
    sessions: &mut Vec<Session>,
    device: &Id,
    generation: &Generation,
    end: Option<u64>,
    completeness: Completeness,
) {
    if let Some(session) = active.take() {
        let duration = if matches!(
            completeness,
            Completeness::Complete | Completeness::Candidate
        ) {
            end.map(|e| e - session.start)
        } else {
            None
        };
        sessions.push(Session {
            device_id: device.clone(),
            generation: generation.clone(),
            start_ms: session.start,
            end_ms: end,
            duration_ms: duration,
            completeness,
            opening_event_id: session.opening_event_id,
        });
    }
}

/// Replays complete causal streams, including preceding-period baselines. Never pre-filter by day.
pub fn reduce(
    events: &[Event],
    interruptions: &[Interruption],
    generation: &Generation,
) -> Result<Summary, DomainError> {
    generation.validate()?;
    let mut identities = BTreeMap::new();
    let mut sources: BTreeMap<(Id, Generation), BTreeMap<u64, &Event>> = BTreeMap::new();
    for event in events {
        event.validate()?;
        if let Some(old) = identities.insert(&event.event_id, event) {
            if old != event {
                return Err(DomainError::IdentityConflict);
            }
            continue;
        }
        let source = (event.device_id.clone(), event.generation.clone());
        if sources
            .entry(source)
            .or_default()
            .insert(event.sequence, event)
            .is_some()
        {
            return Err(DomainError::SequenceConflict);
        }
    }
    let mut markers = BTreeMap::new();
    for marker in interruptions {
        marker.validate()?;
        if let Some(old) = markers.insert(&marker.interruption_id, marker)
            && old != marker
        {
            return Err(DomainError::IdentityConflict);
        }
    }
    let mut result = Summary::default();
    for ((device, source_generation), ordered) in sources {
        if &source_generation != generation {
            continue;
        }
        let positions: BTreeSet<u64> = markers
            .values()
            .filter(|m| m.device_id == device && m.generation == source_generation)
            .map(|m| m.after_sequence)
            .collect();
        let mut positions = positions.into_iter().peekable();
        let mut last = None;
        let mut active: Option<Active> = None;
        for event in ordered.values() {
            while positions
                .peek()
                .is_some_and(|position| *position < event.sequence)
            {
                finish(
                    &mut active,
                    &mut result.sessions,
                    &device,
                    generation,
                    None,
                    Completeness::Incomplete,
                );
                positions.next();
            }
            if event.is_test {
                continue;
            }
            match event.transition {
                Transition::Open => {
                    if last == Some(Transition::Open) {
                        finish(
                            &mut active,
                            &mut result.sessions,
                            &device,
                            generation,
                            None,
                            Completeness::Incomplete,
                        );
                        active = Some(Active {
                            start: event.observed_at_ms,
                            candidate: true,
                            opening_event_id: event.event_id.clone(),
                        });
                    } else {
                        result.opens += 1;
                        result.counted_events.push(event.event_id.clone());
                        active = Some(Active {
                            start: event.observed_at_ms,
                            candidate: false,
                            opening_event_id: event.event_id.clone(),
                        });
                    }
                }
                Transition::Close => {
                    if last != Some(Transition::Close) {
                        result.closes += 1;
                        result.counted_events.push(event.event_id.clone());
                    }
                    if let Some(session) = active.as_ref() {
                        let completeness = if event.observed_at_ms < session.start {
                            Completeness::Incomplete
                        } else if session.candidate {
                            Completeness::Candidate
                        } else {
                            result.cycles += 1;
                            Completeness::Complete
                        };
                        finish(
                            &mut active,
                            &mut result.sessions,
                            &device,
                            generation,
                            Some(event.observed_at_ms),
                            completeness,
                        );
                    }
                }
            }
            last = Some(event.transition);
        }
        if positions.peek().is_some() {
            finish(
                &mut active,
                &mut result.sessions,
                &device,
                generation,
                None,
                Completeness::Incomplete,
            );
        }
        finish(
            &mut active,
            &mut result.sessions,
            &device,
            generation,
            None,
            Completeness::Running,
        );
    }
    for session in &result.sessions {
        result.complete_duration_ms = result
            .complete_duration_ms
            .checked_add(session.duration_ms.unwrap_or(0))
            .filter(|sum| *sum <= i64::MAX as u64)
            .ok_or(DomainError::Overflow)?;
    }
    Ok(result)
}

/// User deletion suppresses contributions after causal replay. Removing an observation
/// before replay could turn a later repeated state into a new fold, increasing scores.
pub fn reduce_with_deletions(
    events: &[Event],
    interruptions: &[Interruption],
    generation: &Generation,
    deleted: &BTreeSet<Id>,
) -> Result<Summary, DomainError> {
    let mut summary = reduce(events, interruptions, generation)?;
    if deleted.is_empty() {
        return Ok(summary);
    }
    let by_id: BTreeMap<_, _> = events.iter().map(|e| (&e.event_id, e)).collect();
    summary.counted_events.retain(|id| {
        if !deleted.contains(id) {
            return true;
        }
        if let Some(event) = by_id.get(id) {
            match event.transition {
                Transition::Open => summary.opens -= 1,
                Transition::Close => summary.closes -= 1,
            }
        }
        false
    });
    summary
        .sessions
        .retain(|session| !deleted.contains(&session.opening_event_id));
    summary.cycles = summary
        .sessions
        .iter()
        .filter(|s| s.completeness == Completeness::Complete)
        .count() as u64;
    summary.complete_duration_ms = summary
        .sessions
        .iter()
        .map(|s| s.duration_ms.unwrap_or(0))
        .sum();
    Ok(summary)
}
