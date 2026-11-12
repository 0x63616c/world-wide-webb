-- Adjacent accepted observations suffice for insertion deltas, including late arrivals.
CREATE INDEX observation_scoring_neighbors ON observations(
 participant_id,device_id,
 json_extract(event_json,'$.generation.revision'),
 json_extract(event_json,'$.generation.reset_id'),sequence
) WHERE disposition='accepted' AND json_extract(event_json,'$.is_test')=0;
CREATE INDEX jobs_category_state ON jobs(kind,state);
CREATE INDEX periods_due ON periods(state,end_ms,cutoff_ms);
CREATE INDEX avatar_alerts_due ON avatar_alerts(state,lease_until_ms);
CREATE INDEX deletion_operations_due ON deletion_operations(state,lease_until_ms);
CREATE INDEX avatar_cleanup_due ON avatar_objects(state,created_at_ms);
