//! Incremental reward projection uses contribution differences, not replacement of
//! neighbor subsets: the outer boundary may be a repeated state in the full stream.
use folding_domain::{
    DomainError,
    milestones::UTC_DAY_MS,
    wire::{Id, MAX_SAFE_INTEGER},
};
use std::collections::BTreeMap;

#[derive(Debug, PartialEq, Eq)]
pub struct Delta {
    pub removed: Vec<Id>,
    pub added: Vec<(Id, u64)>,
    pub days: BTreeMap<u64, i64>,
}

pub fn delta(before: &[(Id, u64)], after: &[(Id, u64)]) -> Result<Delta, DomainError> {
    fn indexed(values: &[(Id, u64)]) -> Result<BTreeMap<Id, u64>, DomainError> {
        let mut result = BTreeMap::new();
        for (id, time) in values {
            if *time > MAX_SAFE_INTEGER {
                return Err(DomainError::InvalidEnvelope);
            }
            if let Some(old) = result.insert(id.clone(), *time) {
                if old != *time {
                    return Err(DomainError::IdentityConflict);
                }
            }
        }
        Ok(result)
    }
    let before = indexed(before)?;
    let after = indexed(after)?;
    let mut result = Delta {
        removed: vec![],
        added: vec![],
        days: BTreeMap::new(),
    };
    for (id, time) in &before {
        if let Some(next) = after.get(id) {
            if next != time {
                return Err(DomainError::IdentityConflict);
            }
        } else {
            result.removed.push(id.clone());
            *result.days.entry(time / UTC_DAY_MS).or_default() -= 1;
        }
    }
    for (id, time) in after {
        if !before.contains_key(&id) {
            result.added.push((id, time));
            *result.days.entry(time / UTC_DAY_MS).or_default() += 1;
        }
    }
    result.days.retain(|_, change| *change != 0);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn id(n: u64) -> Id {
        Id::parse(&format!("00000000-0000-0000-0000-{n:012}")).unwrap()
    }

    #[test]
    fn boundary_neighbors_cancel_and_retries_do_not_add_days() {
        let before = [(id(1), 0), (id(3), UTC_DAY_MS)];
        let after = [(id(1), 0), (id(2), UTC_DAY_MS - 1), (id(3), UTC_DAY_MS)];
        let change = delta(&before, &after).unwrap();
        assert!(change.removed.is_empty());
        assert_eq!(change.added, [(id(2), UTC_DAY_MS - 1)]);
        assert_eq!(change.days, BTreeMap::from([(0, 1)]));
        assert_eq!(
            delta(&after, &after).unwrap(),
            Delta {
                removed: vec![],
                added: vec![],
                days: BTreeMap::new()
            }
        );
    }

    #[test]
    fn replay_can_replace_a_counted_event_without_changing_its_day_total() {
        let change = delta(&[(id(1), 100)], &[(id(2), 200)]).unwrap();
        assert_eq!(change.removed, [id(1)]);
        assert_eq!(change.added, [(id(2), 200)]);
        assert!(change.days.is_empty());
        let cross_day = delta(&[(id(1), 100)], &[(id(2), UTC_DAY_MS)]).unwrap();
        assert_eq!(cross_day.days, BTreeMap::from([(0, -1), (1, 1)]));
    }

    #[test]
    fn immutable_identity_conflicts_and_unsafe_timestamps_fail_closed() {
        assert_eq!(
            delta(&[(id(1), 1)], &[(id(1), 2)]),
            Err(DomainError::IdentityConflict)
        );
        assert_eq!(
            delta(&[], &[(id(1), MAX_SAFE_INTEGER + 1)]),
            Err(DomainError::InvalidEnvelope)
        );
        assert_eq!(
            delta(&[], &[(id(1), 1), (id(1), 2)]),
            Err(DomainError::IdentityConflict)
        );
    }

    #[test]
    fn schema_rejects_unearned_features_and_preserves_acknowledgment_on_revocation() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE observations(participant_id TEXT, device_id TEXT, sequence INTEGER, disposition TEXT, event_json TEXT); CREATE TABLE participants(participant_id TEXT PRIMARY KEY); INSERT INTO participants VALUES ('p');").unwrap();
        db.execute_batch(include_str!(
            "../../../migrations/0021_profile_milestones.sql"
        ))
        .unwrap();
        db.execute_batch("INSERT INTO milestone_grants VALUES ('p','folds_1',1000); INSERT INTO milestone_featured VALUES ('p','folds_1'); INSERT INTO milestone_acknowledgments VALUES ('p','folds_1'); DELETE FROM milestone_grants WHERE participant_id='p';").unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM milestone_featured", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM milestone_acknowledgments", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
            1
        );
        assert!(
            db.execute(
                "INSERT INTO milestone_featured VALUES ('p','folds_100')",
                []
            )
            .is_err()
        );
        assert!(
            db.execute(
                "INSERT INTO milestone_grants VALUES ('p','unknown',NULL)",
                []
            )
            .is_err()
        );
        db.execute("DELETE FROM participants WHERE participant_id='p'", [])
            .unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM milestone_acknowledgments", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
    }
}
