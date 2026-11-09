use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;
use std::process::Command;

#[test]
fn package_child() {
    let Some(marker) = std::env::var_os("HOMELAB_PACKAGE_TEST_MARKER") else {
        return;
    };
    let workspace = homelab_client::config::Workspace {
        repository: "example/config".into(),
        revision: "a".repeat(40),
        manifest: serde_json::from_slice(include_bytes!("../examples/homelab.json")).unwrap(),
    };
    let package = homelab_client::package::prepare(&workspace).unwrap();
    assert!(package.directory.join("homelab-host").is_file());
    fs::write(marker, "prepared").unwrap();
}

#[test]
fn symlink_launch_prepares_the_real_bundled_helper() {
    let root = tempfile::tempdir().unwrap();
    let release = root.path().join("Cellar/homelab/version/bin");
    let bin = root.path().join("bin");
    fs::create_dir_all(&release).unwrap();
    fs::create_dir(&bin).unwrap();
    fs::copy(std::env::current_exe().unwrap(), release.join("homelab")).unwrap();
    fs::copy(
        Path::new(env!("CARGO_BIN_EXE_homelab-host")),
        release.join("homelab-host"),
    )
    .unwrap();
    for name in ["homelab", "homelab-host"] {
        symlink(
            format!("../Cellar/homelab/version/bin/{name}"),
            bin.join(name),
        )
        .unwrap();
    }
    let marker = root.path().join("prepared");
    let output = Command::new(bin.join("homelab"))
        .args(["--exact", "package_child", "--nocapture"])
        .env("HOMELAB_PACKAGE_TEST_MARKER", &marker)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(fs::read_to_string(marker).unwrap(), "prepared");
}
