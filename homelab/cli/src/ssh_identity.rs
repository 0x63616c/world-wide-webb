//! A selected agent identity is public data; its private key stays in the agent.
use std::io::Write;
use std::path::Path;
use std::process::Command;

use crate::inventory::AgentIdentity;

pub(crate) fn canonical_key(text: &str) -> Option<String> {
    let text = text.trim();
    if text.contains(['\n', '\r']) {
        return None;
    }
    let mut fields = text.split_whitespace();
    let kind = fields.next()?;
    let encoded = fields.next()?;
    if ![
        "ssh-ed25519",
        "ssh-rsa",
        "ecdsa-sha2-nistp256",
        "ecdsa-sha2-nistp384",
        "ecdsa-sha2-nistp521",
        "sk-ssh-ed25519@openssh.com",
        "sk-ecdsa-sha2-nistp256@openssh.com",
    ]
    .contains(&kind)
        || encoded.is_empty()
        || !encoded
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"+/=".contains(&byte))
    {
        return None;
    }
    Some(format!("{kind} {encoded}"))
}

pub(crate) fn validate_identity(identity: &AgentIdentity) -> bool {
    identity.public_key.len() <= 16384
        && canonical_key(&identity.public_key).as_deref() == Some(identity.public_key.as_str())
        && identity.agent_socket.as_os_str().len() <= 4096
        && identity.agent_socket.is_absolute()
        && identity
            .agent_socket
            .to_str()
            .is_some_and(|path| !path.chars().any(char::is_control))
}

/// Keep the returned public-only file alive until SSH/SCP exits.
pub(crate) fn configure(
    command: &mut Command,
    identity: Option<&AgentIdentity>,
) -> std::io::Result<Option<tempfile::NamedTempFile>> {
    let Some(identity) = identity else {
        return Ok(None);
    };
    if !validate_identity(identity) {
        return Err(std::io::Error::other("invalid agent identity"));
    }
    let mut file = tempfile::NamedTempFile::new()?;
    writeln!(file, "{}", identity.public_key)?;
    // IdentityFile options are additive. Ignoring SSH config is necessary to
    // ensure that only this selected key is offered, even with agent multiplexing.
    command
        .args(["-F", "/dev/null", "-i"])
        .arg(file.path())
        .args([
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "IdentityAgent=SSH_AUTH_SOCK",
            "-o",
            "ControlMaster=no",
            "-o",
            "ControlPath=none",
            "-o",
            "ControlPersist=no",
        ])
        .env("SSH_AUTH_SOCK", Path::new(&identity.agent_socket));
    Ok(Some(file))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selected_identity_ignores_additional_config_identities_without_connecting() {
        let temporary = tempfile::tempdir().unwrap();
        let config = temporary.path().join("ssh-config");
        std::fs::write(
            &config,
            "Host *\n IdentityFile /unwanted/key\n ProxyCommand /unwanted/proxy\n Port 2222\n",
        )
        .unwrap();
        let identity = AgentIdentity {
            public_key: "ssh-ed25519 AAAA".into(),
            agent_socket: temporary.path().join("agent.sock"),
        };
        let mut command = Command::new("ssh");
        command.args(["-G", "-F"]).arg(config);
        let guard = configure(&mut command, Some(&identity)).unwrap().unwrap();
        command.arg("192.0.2.1").stdin(std::process::Stdio::null());
        let output =
            crate::process::capture(&mut command, std::time::Duration::from_secs(5)).unwrap();
        assert!(output.status.success());
        let text = String::from_utf8(output.stdout).unwrap();
        let files: Vec<_> = text
            .lines()
            .filter_map(|line| line.strip_prefix("identityfile "))
            .collect();
        assert_eq!(files, vec![guard.path().to_str().unwrap()]);
        assert!(text.lines().any(|line| line == "port 22"));
        assert!(!text.contains("/unwanted/"));
        assert!(text.lines().any(|line| line == "identitiesonly yes"));
    }
}
