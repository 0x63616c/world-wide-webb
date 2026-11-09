//! Runs only in the pinned, offline Hindsight container with synthetic data.

use std::fs::{self, File};
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;

const PG0: &str = "/app/api/.venv/lib/python3.11/site-packages/pg0/bin/pg0";
const TARGET_HOME: &str = "/home/hindsight";
const PASSWORD: &str = "synthetic-secret-must-not-appear-in-errors";

#[derive(Deserialize)]
struct Instance {
    port: u16,
    installation_dir: PathBuf,
    version: String,
    data_dir: PathBuf,
    username: String,
    password: String,
    database: String,
}

fn command(binary: impl AsRef<Path>, home: &Path) -> Command {
    let mut command = Command::new(binary.as_ref());
    command
        .env_clear()
        .env("HOME", home)
        .env("PATH", "/usr/local/bin:/usr/bin:/bin")
        .env("LANG", "C.UTF-8")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

// pg0 intentionally leaves a database running. The guard below stops that
// database separately; a successful pg0 command is not its process lifetime.
fn run(command: &mut Command, stage: &str) -> ExitStatus {
    let mut child = command
        .spawn()
        .unwrap_or_else(|_| panic!("Cannot start {stage}"));
    let deadline = Instant::now() + Duration::from_secs(660);
    loop {
        if let Some(status) = child.try_wait().expect("Cannot supervise fixture command") {
            return status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("Fixture command timed out: {stage}");
        }
        thread::sleep(Duration::from_millis(50));
    }
}

struct Database {
    home: PathBuf,
    name: &'static str,
}

impl Database {
    fn start(&self) -> Instance {
        let mut start = command(PG0, &self.home);
        start.args([
            "start",
            "--name",
            self.name,
            "--username",
            "hindsight",
            "--password",
            if self.name == "source" {
                PASSWORD
            } else {
                "hindsight"
            },
            "--database",
            "hindsight",
            "--version",
            "18.1.0",
        ]);
        assert!(run(&mut start, "pg0 start").success(), "pg0 start failed");
        self.instance()
    }

    fn instance(&self) -> Instance {
        let path = self
            .home
            .join(".pg0/instances")
            .join(self.name)
            .join("instance.json");
        let data = fs::read(path).expect("Missing pg0 instance metadata");
        serde_json::from_slice(&data).expect("Invalid pg0 instance metadata")
    }

    fn stop(&self) {
        let instance = self.instance();
        let mut stop = command(PG0, &self.home);
        stop.args(["stop", "--name", self.name, "--timeout", "60"])
            .env(
                "LD_LIBRARY_PATH",
                self.home.join(".pg0/installation/18.1.0/lib"),
            );
        assert!(run(&mut stop, "pg0 stop").success(), "pg0 stop failed");
        assert!(
            !instance.data_dir.join("postmaster.pid").exists(),
            "Database still running"
        );
    }
}

impl Drop for Database {
    fn drop(&mut self) {
        // Also clean up after a failed assertion; never print pg0 connection data.
        let mut stop = command(PG0, &self.home);
        stop.args(["stop", "--name", self.name, "--timeout", "60"])
            .env(
                "LD_LIBRARY_PATH",
                self.home.join(".pg0/installation/18.1.0/lib"),
            );
        if let Ok(mut child) = stop.spawn() {
            let deadline = Instant::now() + Duration::from_secs(75);
            while matches!(child.try_wait(), Ok(None)) && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(50));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn postgres(instance: &Instance, home: &Path, tool: &str) -> Command {
    let installation = instance.installation_dir.join(&instance.version);
    let mut command = command(installation.join("bin").join(tool), home);
    command
        .env("PGPASSWORD", &instance.password)
        .env("LD_LIBRARY_PATH", installation.join("lib"))
        .args([
            "-h",
            "127.0.0.1",
            "-p",
            &instance.port.to_string(),
            "-U",
            &instance.username,
            "-d",
            &instance.database,
        ]);
    command
}

fn sql(instance: &Instance, home: &Path, query: &str) -> String {
    let mut output = tempfile::tempfile().unwrap();
    let mut psql = postgres(instance, home, "psql");
    psql.args(["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", query]);
    psql.stdout(output.try_clone().unwrap());
    assert!(
        run(&mut psql, "synthetic SQL").success(),
        "Synthetic SQL failed"
    );
    use std::io::{Seek, SeekFrom};
    output.seek(SeekFrom::Start(0)).unwrap();
    let mut result = String::new();
    output.take(16_384).read_to_string(&mut result).unwrap();
    result.trim().to_owned()
}

fn cli_failure(binary: &Path, dump: &Path) -> String {
    let mut output = tempfile::tempfile().unwrap();
    let mut restore = command(binary, Path::new(TARGET_HOME));
    restore.args(["rehearse-hindsight-restore", "--dump"]);
    restore
        .arg(dump)
        .stdout(output.try_clone().unwrap())
        .stderr(output.try_clone().unwrap());
    assert!(!run(&mut restore, "expected restore rejection").success());
    use std::io::{Seek, SeekFrom};
    output.seek(SeekFrom::Start(0)).unwrap();
    let mut message = String::new();
    output.take(16_384).read_to_string(&mut message).unwrap();
    assert!(
        !message.contains(PASSWORD),
        "Restore exposed the synthetic password"
    );
    assert!(
        !message.contains("postgresql://"),
        "Restore exposed a connection URI"
    );
    assert!(
        !message.contains("instance.json"),
        "Restore exposed instance metadata"
    );
    assert!(
        !message.trim().is_empty(),
        "Restore supplied no actionable failure"
    );
    message
}

#[test]
#[ignore = "requires the pinned ARM64 Hindsight image, UID 1000, and no network"]
fn synthetic_hindsight_restore() {
    assert_eq!(
        std::env::consts::OS,
        "linux",
        "Requires the pinned Linux container"
    );
    assert_eq!(rustix::process::geteuid().as_raw(), 1000);
    let helper = PathBuf::from(
        std::env::var_os("HOMELAB_HOST_BINARY")
            .expect("Set HOMELAB_HOST_BINARY to the mounted Linux helper"),
    );
    assert!(
        Path::new(PG0).is_file(),
        "Run inside the pinned Hindsight image"
    );
    let target = Path::new(TARGET_HOME).join(".pg0");
    if target.exists() {
        assert!(!target.is_symlink() && target.is_dir());
        assert!(
            fs::read_dir(&target).unwrap().next().is_none(),
            "Refusing existing database state"
        );
    } else {
        fs::create_dir(&target).unwrap();
    }
    fs::set_permissions(&target, fs::Permissions::from_mode(0o700)).unwrap();

    let scratch = tempfile::tempdir().unwrap();
    let source_home = scratch.path().join("source-home");
    fs::create_dir(&source_home).unwrap();
    let source = Database {
        home: source_home,
        name: "source",
    };
    let instance = source.start();
    sql(
        &instance,
        &source.home,
        "CREATE EXTENSION IF NOT EXISTS vector; \
        CREATE SCHEMA rehearsal; \
        CREATE TABLE rehearsal.memories (id bigserial PRIMARY KEY, body text NOT NULL, embedding vector(3)); \
        INSERT INTO rehearsal.memories (body, embedding) VALUES ('café 東京 🦀', '[1,2,3]'), ('second', '[4,5,6]');",
    );
    let dump = scratch.path().join("synthetic.dump");
    let mut pg_dump = postgres(&instance, &source.home, "pg_dump");
    pg_dump.arg("-Fc").stdout(File::create(&dump).unwrap());
    assert!(run(&mut pg_dump, "synthetic dump").success());
    assert!(fs::metadata(&dump).unwrap().len() > 100);
    source.stop();

    // Existing state must be rejected without changing a byte.
    let sentinel = target.join("do-not-overwrite");
    fs::write(&sentinel, PASSWORD).unwrap();
    cli_failure(&helper, &dump);
    assert_eq!(fs::read_to_string(&sentinel).unwrap(), PASSWORD);
    fs::remove_file(sentinel).unwrap();

    // A plausible archive header with missing contents exercises restore failure.
    let truncated = scratch.path().join("truncated.dump");
    let bytes = fs::read(&dump).unwrap();
    fs::write(&truncated, &bytes[..bytes.len() / 2]).unwrap();
    let restored = Database {
        home: PathBuf::from(TARGET_HOME),
        name: "hindsight",
    };
    let failure = cli_failure(&helper, &truncated);
    assert!(
        failure.contains("Database restoration failed"),
        "Truncated dump did not reach the restore operation"
    );
    assert!(
        target.join("instances/hindsight/instance.json").exists(),
        "Failed restore never initialized its database"
    );
    let failed = restored.instance();
    assert!(
        !failed.data_dir.join("postmaster.pid").exists(),
        "Failed restore left PostgreSQL running"
    );
    // Retain failed synthetic state separately; only a newly empty destination retries.
    fs::rename(&target, scratch.path().join("failed-restore")).unwrap();
    fs::create_dir(&target).unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o700)).unwrap();

    homelab_host_ops::hindsight_restore::restore(&dump).expect("Synthetic restore failed");
    let finished = restored.instance();
    assert!(
        !finished.data_dir.join("postmaster.pid").exists(),
        "Restore did not shut down cleanly"
    );
    let instance = restored.start();
    assert_eq!(
        sql(
            &instance,
            &restored.home,
            "SELECT length(body)::text || '|' || body || '|' || embedding::text FROM rehearsal.memories WHERE id=1"
        ),
        "9|café 東京 🦀|[1,2,3]"
    );
    assert_eq!(
        sql(
            &instance,
            &restored.home,
            "INSERT INTO rehearsal.memories(body,embedding) VALUES ('after restore','[7,8,9]') RETURNING id"
        ),
        "3\nINSERT 0 1"
    );
    assert_eq!(
        sql(
            &instance,
            &restored.home,
            "SELECT count(*) FROM rehearsal.memories WHERE embedding <-> '[1,2,3]'::vector = 0"
        ),
        "1"
    );
    restored.stop();
    let instance = restored.start();
    assert_eq!(
        sql(
            &instance,
            &restored.home,
            "SELECT count(*) FROM rehearsal.memories"
        ),
        "3"
    );
    assert_eq!(
        sql(
            &instance,
            &restored.home,
            "SELECT last_value FROM rehearsal.memories_id_seq"
        ),
        "3"
    );
    restored.stop();
}
