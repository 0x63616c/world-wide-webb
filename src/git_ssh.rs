//! Git transport restricted to the target's deploy identity and pinned GitHub host key.
use std::path::Path;
use std::process::Command;

#[derive(Debug, thiserror::Error)]
#[error("The target's deploy identity could not read main from the configuration repository.")]
pub struct AccessUnconfirmed;

pub fn verify_read_access(
    git: &Path,
    private_key: &Path,
    repository: &str,
) -> Result<String, AccessUnconfirmed> {
    if !crate::config::valid_repository(repository) {
        return Err(AccessUnconfirmed);
    }
    let key = crate::deploy_identity::snapshot(private_key, rustix::process::geteuid().as_raw())
        .map_err(|_| AccessUnconfirmed)?;
    let home = tempfile::tempdir().map_err(|_| AccessUnconfirmed)?;
    let known_hosts = home.path().join("known_hosts");
    std::fs::write(&known_hosts, KNOWN_HOSTS).map_err(|_| AccessUnconfirmed)?;
    let mut command = Command::new(git);
    command
        .args([
            "ls-remote",
            "--exit-code",
            &format!("git@github.com:{repository}.git"),
            "refs/heads/main",
        ])
        .env_clear()
        .env("HOME", home.path())
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("LC_ALL", "C")
        .current_dir(home.path())
        .stdin(std::process::Stdio::null());
    configure(&mut command, key.path(), &known_hosts);
    let output = crate::process::capture(&mut command, std::time::Duration::from_secs(60))
        .map_err(|_| AccessUnconfirmed)?;
    if !output.status.success() {
        return Err(AccessUnconfirmed);
    }
    remote_main(&output.stdout)
}

fn remote_main(bytes: &[u8]) -> Result<String, AccessUnconfirmed> {
    let text = std::str::from_utf8(bytes).map_err(|_| AccessUnconfirmed)?;
    let (revision, reference) = text
        .trim_end_matches('\n')
        .split_once('\t')
        .ok_or(AccessUnconfirmed)?;
    if !crate::config::valid_revision(revision) || reference != "refs/heads/main" {
        return Err(AccessUnconfirmed);
    }
    Ok(revision.into())
}

pub const KNOWN_HOSTS: &str = include_str!("github_known_hosts");

fn quoted(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

pub fn configure(command: &mut Command, private_key: &Path, known_hosts: &Path) {
    // Git interprets GIT_SSH_COMMAND through a shell; quote each variable path.
    let ssh = format!(
        "/usr/bin/ssh -F /dev/null -i {} -o UserKnownHostsFile={} -o GlobalKnownHostsFile=/dev/null -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ssh-ed25519 -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o ControlMaster=no -o ControlPath=none -o ConnectTimeout=15",
        quoted(private_key),
        quoted(known_hosts),
    );
    command
        .env("GIT_SSH_COMMAND", ssh)
        .env("GIT_SSH_VARIANT", "ssh")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_COUNT", "2")
        .env("GIT_CONFIG_KEY_0", "credential.helper")
        .env("GIT_CONFIG_VALUE_0", "")
        .env("GIT_CONFIG_KEY_1", "core.hooksPath")
        .env("GIT_CONFIG_VALUE_1", "/dev/null")
        .env_remove("SSH_AUTH_SOCK")
        .env_remove("GIT_ASKPASS");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_access_requires_one_exact_main_reference() {
        let revision = "a".repeat(40);
        assert_eq!(
            remote_main(format!("{revision}\trefs/heads/main\n").as_bytes()).unwrap(),
            revision
        );
        for value in [
            format!("{revision}\trefs/heads/other\n"),
            format!("{revision}\trefs/heads/main\n{revision}\trefs/heads/other\n"),
            "error: permission denied".into(),
            "bad\trefs/heads/main\n".into(),
        ] {
            assert!(remote_main(value.as_bytes()).is_err());
        }
    }
    #[test]
    fn path_shell_metacharacters_remain_literal() {
        let path = Path::new("/tmp/key's $(touch nope) `x`");
        let output = Command::new("/bin/sh")
            .args(["-c", &format!("printf '%s' {}", quoted(path))])
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, path.as_os_str().as_encoded_bytes());
    }
}
