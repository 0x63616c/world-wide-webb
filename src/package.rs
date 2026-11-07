//! Assemble a private review bundle from the installed, versioned helper.
use crate::config::Workspace;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use thiserror::Error;

pub struct Package {
    pub directory: PathBuf,
    _temporary: tempfile::TempDir,
}
#[derive(Clone, Copy, Debug, Error)]
pub enum Error {
    #[error(
        "The bundled homelab-host helper could not be read or is not a safe executable. Reinstall homelab from the official release or Homebrew tap."
    )]
    Helper,
    #[error(
        "The bundled homelab-host helper could not run or does not match this CLI version. Reinstall homelab from the official release or Homebrew tap."
    )]
    Version,
    #[error("The private bootstrap review bundle could not be prepared.")]
    Prepare,
}
impl Error {
    pub fn next_action(&self) -> &'static str {
        "Check the installation and available local storage, then retry. No target was changed."
    }
}
pub fn prepare(workspace: &Workspace) -> Result<Package, Error> {
    let executable = std::env::current_exe().map_err(|_| Error::Helper)?;
    prepare_at(workspace, &executable)
}

fn prepare_at(workspace: &Workspace, executable: &Path) -> Result<Package, Error> {
    // macOS preserves Homebrew's launch symlink in current_exe. Resolve the CLI
    // first so its helper comes from the same installed release, not PATH.
    let executable = fs::canonicalize(executable).map_err(|_| Error::Helper)?;
    let helper = executable
        .parent()
        .ok_or(Error::Helper)?
        .join("homelab-host");
    let package = assemble(workspace, &helper)?;
    verify_version(&package.directory.join("homelab-host"))?;
    Ok(package)
}

fn verify_version(helper: &Path) -> Result<(), Error> {
    let mut command = std::process::Command::new(helper);
    command.arg("--version").stdin(std::process::Stdio::null());
    let output = crate::process::capture(&mut command, std::time::Duration::from_secs(10))
        .map_err(|_| Error::Version)?;
    if !output.status.success()
        || String::from_utf8_lossy(&output.stdout).trim()
            != concat!("homelab-host ", env!("CARGO_PKG_VERSION"))
    {
        return Err(Error::Version);
    }
    Ok(())
}
fn assemble(workspace: &Workspace, helper: &Path) -> Result<Package, Error> {
    workspace.manifest.validate().map_err(|_| Error::Prepare)?;
    if !crate::config::valid_repository(&workspace.repository)
        || !crate::config::valid_revision(&workspace.revision)
    {
        return Err(Error::Prepare);
    }
    let m = fs::symlink_metadata(helper).map_err(|_| Error::Helper)?;
    if !m.is_file() || m.mode() & 0o022 != 0 || m.mode() & 0o111 == 0 || m.len() > 100 * 1024 * 1024
    {
        return Err(Error::Helper);
    }
    let dir = tempfile::tempdir().map_err(|_| Error::Prepare)?;
    let directory = dir.path().to_owned();
    fs::copy(helper, directory.join("homelab-host")).map_err(|_| Error::Prepare)?;
    let wrapper =
        b"#!/bin/sh\nset -eu\nexec \"$(dirname -- \"$0\")/homelab-host\" bootstrap \"$@\"\n";
    let plan=serde_json::to_vec(&json!({"schema":2,"repository":workspace.repository,"revision":workspace.revision,"hosts":workspace.manifest.hosts})).map_err(|_|Error::Prepare)?;
    for (name, data) in [
        ("bootstrap.sh", wrapper.as_slice()),
        ("REVISION", workspace.revision.as_bytes()),
        ("setup-plan.json", plan.as_slice()),
    ] {
        fs::write(directory.join(name), data).map_err(|_| Error::Prepare)?;
    }
    let mut hashes = String::new();
    for name in [
        "homelab-host",
        "bootstrap.sh",
        "REVISION",
        "setup-plan.json",
    ] {
        let path = directory.join(name);
        fs::set_permissions(
            &path,
            fs::Permissions::from_mode(if matches!(name, "homelab-host" | "bootstrap.sh") {
                0o700
            } else {
                0o600
            }),
        )
        .map_err(|_| Error::Prepare)?;
        let bytes = fs::read(&path).map_err(|_| Error::Prepare)?;
        hashes.push_str(&format!(
            "{}  {name}\n",
            Sha256::digest(bytes)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        ));
    }
    fs::write(directory.join("SHA256SUMS"), hashes).map_err(|_| Error::Prepare)?;
    fs::set_permissions(
        directory.join("SHA256SUMS"),
        fs::Permissions::from_mode(0o600),
    )
    .map_err(|_| Error::Prepare)?;
    Ok(Package {
        directory,
        _temporary: dir,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn homebrew_launch_link_uses_its_own_release_helper() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join("bin");
        let release = root.path().join("Cellar/homelab/version/bin");
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(&release).unwrap();
        fs::write(release.join("homelab"), "fixture CLI").unwrap();
        let helper = release.join("homelab-host");
        fs::write(
            &helper,
            concat!(
                "#!/bin/sh\nprintf 'homelab-host ",
                env!("CARGO_PKG_VERSION"),
                "\\n'\n"
            ),
        )
        .unwrap();
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o555)).unwrap();
        symlink("../Cellar/homelab/version/bin/homelab", bin.join("homelab")).unwrap();
        symlink(
            "../Cellar/homelab/version/bin/homelab-host",
            bin.join("homelab-host"),
        )
        .unwrap();
        let workspace = Workspace {
            repository: "example/config".into(),
            revision: "a".repeat(40),
            manifest: serde_json::from_slice(include_bytes!("../examples/homelab.json")).unwrap(),
        };
        let package = prepare_at(&workspace, &bin.join("homelab")).unwrap();
        verify_version(&package.directory.join("homelab-host")).unwrap();

        // A sibling symlink inside the release could cross into another version.
        fs::rename(&helper, release.join("other-helper")).unwrap();
        symlink("other-helper", &helper).unwrap();
        assert!(matches!(
            prepare_at(&workspace, &bin.join("homelab")),
            Err(Error::Helper)
        ));
    }

    #[test]
    fn another_release_cannot_be_used_as_the_installed_helper() {
        let dir = tempfile::tempdir().unwrap();
        let helper = dir.path().join("helper");
        fs::write(&helper, "#!/bin/sh\nprintf 'homelab-host 0.0.0\\n'\n").unwrap();
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(matches!(verify_version(&helper), Err(Error::Version)));
        fs::write(
            &helper,
            concat!(
                "#!/bin/sh\nprintf 'homelab-host ",
                env!("CARGO_PKG_VERSION"),
                "\\n'\n"
            ),
        )
        .unwrap();
        verify_version(&helper).unwrap();
    }
    #[test]
    fn bundle_binds_repository_revision_and_manifest_without_nix() {
        let d = tempfile::tempdir().unwrap();
        let helper = d.path().join("homelab-host");
        fs::write(&helper, b"synthetic helper").unwrap();
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
        let w=Workspace{repository:"example/config".into(),revision:"a".repeat(40),manifest:serde_json::from_value(json!({"schema":1,"hosts":{"build-mac":{"adminUser":"admin","adminUID":501,"authorizedKeys":[],"activationReady":false,"services":[]}},"tailscale":null})).unwrap()};
        let p = assemble(&w, &helper).unwrap();
        let plan: serde_json::Value =
            serde_json::from_slice(&fs::read(p.directory.join("setup-plan.json")).unwrap())
                .unwrap();
        assert_eq!(plan["schema"], 2);
        assert_eq!(plan["repository"], w.repository);
        assert_eq!(plan["revision"], w.revision);
        assert_eq!(plan["hosts"]["build-mac"]["activationReady"], false);
        assert_eq!(
            fs::read_to_string(p.directory.join("SHA256SUMS"))
                .unwrap()
                .lines()
                .count(),
            4
        );
    }
}
