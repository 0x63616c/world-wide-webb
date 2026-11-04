use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

use homelab_client::health::{Config, HealthError, Service, check_once, wait_healthy};
use serde_json::{Value, json};

struct Fixture {
    directory: tempfile::TempDir,
    config: Config,
}
impl Fixture {
    fn new(services: Vec<Service>) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let docker_path = directory.path().join("docker");
        let build = Command::new("rustc")
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/health.rs"))
            .arg("-o")
            .arg(&docker_path)
            .output()
            .unwrap();
        assert!(
            build.status.success(),
            "{}",
            String::from_utf8_lossy(&build.stderr)
        );
        let config = Config {
            services,
            workers_enabled: false,
            docker_path,
            release_path: directory.path().join("release.json"),
        };
        let fixture = Self { directory, config };
        let image = format!(
            "ghcr.io/0x63616c/www-control-center-mini@sha256:{}",
            "a".repeat(64)
        );
        let postgres = format!("postgres@sha256:{}", "b".repeat(64));
        fixture.json("release.json", json!({"schemaVersion":1,"sourceRepository":"0x63616c/world-wide-webb","sourceRevision":"a".repeat(40),"image":image,"postgresImage":postgres}));
        for name in [
            "www-control-center-www-1",
            "www-control-center-postgres-1",
            "bambuddy",
            "bambu-studio-api",
            "bambuddy-tailscale",
            "hindsight",
            "www-tunnel-cloudflared-1",
            "www-home-assistant-home-assistant-1",
        ] {
            fixture.json(&format!("{name}.json"), json!({"running":true,"health":if ["bambuddy-tailscale","www-tunnel-cloudflared-1"].contains(&name) { Value::Null } else { json!("healthy") },"image":match name {"www-control-center-www-1" => image.clone(),"www-control-center-postgres-1" => postgres.clone(),_ => "fixture-image".into()}}));
        }
        fixture.json("control-center.json", json!({"database":"ok","stopping":false,"workersEnabled":false,"sourceRevision":"a".repeat(40)}));
        fixture.json("tailscale.json", json!({"BackendState":"Running","Self":{"Online":true},"TailscaleIPs":["100.100.100.1"],"Health":null}));
        fixture
    }
    fn json(&self, name: &str, value: Value) {
        fs::write(
            self.directory.path().join(name),
            serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
    }
    fn change(&self, name: &str, field: &str, value: Value) {
        let mut data: Value =
            serde_json::from_slice(&fs::read(self.directory.path().join(name)).unwrap()).unwrap();
        data[field] = value;
        self.json(name, data);
    }
    fn flag(&self, name: &str) {
        fs::write(self.directory.path().join(name), "").unwrap();
    }
    fn check(&self) -> Result<(), HealthError> {
        check_once(&self.config, Instant::now() + Duration::from_secs(3))
    }
    fn events(&self) -> String {
        fs::read_to_string(self.directory.path().join("events")).unwrap_or_default()
    }
}

#[test]
fn assigned_services_use_the_correct_runtime_and_real_readiness_commands() {
    let fixture = Fixture::new(vec![
        Service::ControlCenter,
        Service::Bambuddy,
        Service::Hindsight,
        Service::Cloudflared,
        Service::HomeAssistant,
    ]);
    fixture.check().unwrap();
    assert_eq!(fixture.events().lines().count(), 11);
    let fixture = Fixture::new(vec![]);
    fixture.check().unwrap();
    assert!(fixture.events().is_empty());
}

#[test]
fn required_docker_health_is_not_optional_even_for_inherited_bambuddy_check() {
    for (service, name) in [
        (Service::ControlCenter, "www-control-center-www-1"),
        (Service::ControlCenter, "www-control-center-postgres-1"),
        (Service::Bambuddy, "bambuddy"),
        (Service::Bambuddy, "bambu-studio-api"),
        (Service::Hindsight, "hindsight"),
        (
            Service::HomeAssistant,
            "www-home-assistant-home-assistant-1",
        ),
    ] {
        let fixture = Fixture::new(vec![service]);
        for status in [Value::Null, json!("starting"), json!("unhealthy")] {
            fixture.change(&format!("{name}.json"), "health", status);
            assert_eq!(fixture.check(), Err(HealthError::UnhealthyContainer(name)));
        }
    }
}

#[test]
fn control_center_requires_exact_images_revision_database_and_boolean_worker_mode() {
    let fixture = Fixture::new(vec![Service::ControlCenter]);
    for (field, value) in [
        ("database", json!("error")),
        ("stopping", json!(true)),
        ("stopping", Value::Null),
        ("workersEnabled", json!(true)),
        ("workersEnabled", json!(0)),
        ("sourceRevision", json!("b".repeat(40))),
    ] {
        fixture.json("control-center.json", json!({"database":"ok","stopping":false,"workersEnabled":false,"sourceRevision":"a".repeat(40)}));
        fixture.change("control-center.json", field, value);
        assert_eq!(fixture.check(), Err(HealthError::ControlCenterMismatch));
    }
    for name in ["www-control-center-www-1", "www-control-center-postgres-1"] {
        let fixture = Fixture::new(vec![Service::ControlCenter]);
        fixture.change(&format!("{name}.json"), "image", json!("wrong-image"));
        assert_eq!(fixture.check(), Err(HealthError::ControlCenterMismatch));
        assert!(!fixture.events().contains("exec"));
    }
}

#[test]
fn running_tunnel_and_sidecar_are_not_sufficient() {
    let fixture = Fixture::new(vec![Service::Cloudflared]);
    fixture.flag("tunnel-fails");
    assert_eq!(fixture.check(), Err(HealthError::TunnelNotReady));
    let fixture = Fixture::new(vec![Service::Bambuddy]);
    for status in [
        json!({"BackendState":"NeedsLogin","Self":{"Online":true},"TailscaleIPs":["100.100.100.1"]}),
        json!({"BackendState":"Running","Self":{"Online":false},"TailscaleIPs":["100.100.100.1"]}),
        json!({"BackendState":"Running","TailscaleIPs":["100.100.100.1"]}),
        json!({"BackendState":"Running","Self":{"Online":"true"},"TailscaleIPs":["100.100.100.1"]}),
        json!({"BackendState":"Running","Self":{"Online":true},"TailscaleIPs":[]}),
        json!({"BackendState":"Running","Self":{"Online":true},"TailscaleIPs":["100.100.100.1"],"Health":["private diagnostic"]}),
    ] {
        fixture.json("tailscale.json", status);
        assert_eq!(fixture.check(), Err(HealthError::TailscaleNotReady));
    }
}

#[test]
fn deadline_bounds_probes_and_retry_sleep_without_starting_expired_work() {
    let fixture = Fixture::new(vec![Service::Cloudflared]);
    assert_eq!(
        check_once(&fixture.config, Instant::now()),
        Err(HealthError::Deadline)
    );
    assert!(fixture.events().is_empty());
    fixture.flag("slow");
    let started = Instant::now();
    assert_eq!(
        wait_healthy(&fixture.config, Duration::from_millis(50)),
        Err(HealthError::Deadline)
    );
    assert!(started.elapsed() < Duration::from_secs(1));
    assert!(fixture.events().lines().count() <= 1);
    fs::remove_file(fixture.directory.path().join("slow")).unwrap();
    fixture.change("www-tunnel-cloudflared-1.json", "running", json!(false));
    let started = Instant::now();
    assert_eq!(
        wait_healthy(&fixture.config, Duration::from_millis(500)),
        Err(HealthError::UnhealthyContainer("www-tunnel-cloudflared-1"))
    );
    assert!(started.elapsed() < Duration::from_secs(1));
}

#[test]
fn oversized_output_and_errors_never_expose_container_payloads() {
    for flag in ["noisy", "fail"] {
        let fixture = Fixture::new(vec![Service::Cloudflared]);
        fixture.flag(flag);
        let error = fixture.check().unwrap_err();
        assert_eq!(error, HealthError::ProbeUnavailable);
        assert!(!format!("{error:?} {error}").contains("private-payload"));
    }
}

#[test]
fn invalid_release_is_rejected_before_any_probe() {
    let fixture = Fixture::new(vec![Service::ControlCenter]);
    fixture.change("release.json", "sourceRevision", json!("main"));
    assert_eq!(fixture.check(), Err(HealthError::InvalidRelease));
    assert!(fixture.events().is_empty());
    fs::remove_file(&fixture.config.release_path).unwrap();
    assert!(
        Command::new("/usr/bin/mkfifo")
            .arg(&fixture.config.release_path)
            .status()
            .unwrap()
            .success()
    );
    assert_eq!(fixture.check(), Err(HealthError::InvalidRelease));
    assert!(fixture.events().is_empty());
}

#[test]
fn invalid_configuration_does_not_wait_or_run_probes() {
    let mut fixture = Fixture::new(vec![Service::Cloudflared, Service::Cloudflared]);
    assert_eq!(
        wait_healthy(&fixture.config, Duration::from_secs(120)),
        Err(HealthError::InvalidConfig)
    );
    fixture.config.services.pop();
    fixture.config.docker_path = "docker".into();
    assert_eq!(
        wait_healthy(&fixture.config, Duration::from_secs(120)),
        Err(HealthError::InvalidConfig)
    );
    assert!(fixture.events().is_empty());
}

#[test]
fn checked_javascript_asset_rejects_http_errors_and_emits_only_health_facts() {
    let asset = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/probes/control-center.mjs");
    for (wrapped, ok) in [(true, true), (false, true), (true, false)] {
        let health = json!({"database":"ok","stopping":false,"cycles":{"enabled":false},"private":"never-output"});
        let data = if wrapped {
            json!({"json":{"hash":"a".repeat(40)}})
        } else {
            json!({"hash":"a".repeat(40)})
        };
        let build = json!({"result":{"data":data},"private":"never-output"});
        let harness = format!(
            "globalThis.fetch = async (url, options) => {{ if (!options.signal) throw new Error('missing timeout'); return {{ ok: {ok}, json: async () => url.endsWith('/healthz') ? {health} : {build} }}; }}; await import({});",
            serde_json::to_string(asset.to_str().unwrap()).unwrap()
        );
        let output = Command::new("node")
            .args(["--input-type=module", "-e", &harness])
            .output()
            .expect("Node is required to check the health probe asset");
        assert_eq!(
            output.status.success(),
            ok,
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        if ok {
            let value: Value = serde_json::from_slice(&output.stdout).unwrap();
            assert_eq!(value.as_object().unwrap().len(), 4);
            assert_eq!(value["sourceRevision"], "a".repeat(40));
        } else {
            assert!(output.stdout.is_empty());
        }
        assert!(!String::from_utf8_lossy(&output.stdout).contains("never-output"));
        assert!(output.stderr.is_empty());
    }
}
