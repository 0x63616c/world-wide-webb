//! Operations reuse Linux isolation. Approved main workflows with a successful
//! source check authorize capacity creation, not exclusive job affinity: GitHub
//! can assign another matching job before controller revalidation. No extra
//! network access or credentials are provisioned by this label.
use crate::github::GithubJob;
use serde_json::Value;

pub fn authorized(
    repository: &str,
    run: &Value,
    candidate: &GithubJob,
    jobs: &[GithubJob],
) -> bool {
    let pair = match run.get("path").and_then(Value::as_str) {
        Some(".github/workflows/cloudflare.yml") => ("Cloudflare source", "Cloudflare apply"),
        Some(".github/workflows/homelab-operations-canary.yml") => {
            ("Operations source", "Operations canary")
        }
        _ => return false,
    };
    let Some(source) = run.get("head_sha").and_then(Value::as_str) else {
        return false;
    };
    if (source.len() != 40
        || !source
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
        || crate::config::Platform::resolve(&candidate.labels)
            != Some(crate::config::Platform::LinuxOperationsArm64)
        || run.get("id").and_then(Value::as_u64) != Some(candidate.run_id)
        || run.get("run_attempt").and_then(Value::as_u64) != Some(candidate.run_attempt)
        || run.get("head_branch").and_then(Value::as_str) != Some("main")
        || run
            .pointer("/head_repository/full_name")
            .and_then(Value::as_str)
            != Some(repository)
        || !matches!(
            run.get("event").and_then(Value::as_str),
            Some("workflow_run" | "workflow_dispatch")
        )
        || candidate.name != pair.1
        || candidate.head_sha != source
    {
        return false;
    }
    let prerequisites: Vec<_> = jobs.iter().filter(|job| job.name == pair.0).collect();
    prerequisites.len() == 1
        && prerequisites[0].run_id == candidate.run_id
        && prerequisites[0].run_attempt == candidate.run_attempt
        && prerequisites[0].head_sha == source
        && prerequisites[0].status == "completed"
        && prerequisites[0].conclusion.as_deref() == Some("success")
        && crate::config::Platform::resolve(&prerequisites[0].labels)
            == Some(crate::config::Platform::LinuxArm64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub fn fixture() -> (Value, GithubJob, GithubJob) {
        let run = json!({"id":7,"run_attempt":3,"head_sha":"a".repeat(40),"head_branch":"main",
            "head_repository":{"full_name":"allowed/repo"},"event":"workflow_run",
            "path":".github/workflows/cloudflare.yml"});
        let candidate: GithubJob =
            serde_json::from_value(json!({"id":9,"run_id":7,"run_attempt":3,
            "status":"queued","name":"Cloudflare apply","head_sha":"a".repeat(40),
            "labels":["self-hosted","Linux","ARM64","homelab-operations"],
            "created_at":"2026-11-01T00:00:00Z","operations_authorized":true}))
            .unwrap();
        let prerequisite: GithubJob =
            serde_json::from_value(json!({"id":8,"run_id":7,"run_attempt":3,
            "status":"completed","conclusion":"success","name":"Cloudflare source",
            "head_sha":"a".repeat(40),"labels":["self-hosted","Linux","ARM64","homelab-linux"],
            "created_at":"2026-11-01T00:00:00Z"}))
            .unwrap();
        (run, candidate, prerequisite)
    }

    #[test]
    fn label_or_json_alone_cannot_authorize_operations() {
        let (run, candidate, source) = fixture();
        assert!(!candidate.supported_profile());
        assert!(authorized("allowed/repo", &run, &candidate, &[source]));
    }

    #[test]
    fn main_workflow_source_attempt_and_identity_must_all_match() {
        let (run, candidate, source) = fixture();
        for (key, value) in [
            ("event", json!("pull_request")),
            ("head_branch", json!("feature")),
            ("head_sha", json!("b".repeat(40))),
            ("run_attempt", json!(4)),
            ("id", json!(99)),
            ("head_repository", json!({"full_name":"foreign/repo"})),
            ("path", json!(".github/workflows/unapproved.yml")),
            ("path", json!(".github/workflows/deploy-mini.yml")),
        ] {
            let mut changed = run.clone();
            changed[key] = value;
            assert!(
                !authorized(
                    "allowed/repo",
                    &changed,
                    &candidate,
                    std::slice::from_ref(&source)
                ),
                "{key}"
            );
        }
        let mut changed = candidate.clone();
        changed.name = "arbitrary privileged job".into();
        assert!(!authorized("allowed/repo", &run, &changed, &[source]));
    }

    #[test]
    fn source_check_cannot_be_skipped_failed_duplicated_or_from_another_attempt() {
        let (run, candidate, source) = fixture();
        assert!(!authorized("allowed/repo", &run, &candidate, &[]));
        assert!(!authorized(
            "allowed/repo",
            &run,
            &candidate,
            &[source.clone(), source.clone()]
        ));
        for field in 0..5 {
            let mut changed = source.clone();
            match field {
                0 => changed.conclusion = Some("skipped".into()),
                1 => changed.status = "in_progress".into(),
                2 => changed.run_attempt += 1,
                3 => changed.head_sha = "b".repeat(40),
                _ => {
                    changed.labels = crate::config::Platform::LinuxOperationsArm64
                        .labels()
                        .map(String::from)
                        .to_vec()
                }
            }
            assert!(!authorized("allowed/repo", &run, &candidate, &[changed]));
        }
    }
}
