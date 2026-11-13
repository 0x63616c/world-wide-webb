//! Stable resource names survive assignment changes, host renames and recovery.

pub fn valid_host(host: &str) -> bool {
    // The full name is also a DNS label: host + "-job-" + 32 hexadecimal bytes.
    !host.is_empty()
        && host.len() <= 26
        && host.as_bytes()[0].is_ascii_alphanumeric()
        && host.as_bytes()[host.len() - 1].is_ascii_alphanumeric()
        && host
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

pub fn attempt_name(host: &str, nonce: &str) -> String {
    format!("{host}-job-{nonce}")
}

pub fn parse(name: &str) -> Option<(&str, &str)> {
    let (host, nonce) = name.rsplit_once("-job-")?;
    (valid_host(host) && crate::guest::valid_attempt(nonce)).then_some((host, nonce))
}

pub fn belongs_to_host(name: &str, host: &str) -> bool {
    // Legacy names have no host identity. Keep detecting them during rollout.
    name.starts_with("homelab-job-") || name.starts_with(&format!("{host}-job-"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_names_are_bounded_dns_labels() {
        assert!(valid_host("homelab-macbook"));
        assert!(valid_host(&"a".repeat(26)));
        for host in [
            "",
            "-mac",
            "mac-",
            "Mac",
            "mac.local",
            "mac/other",
            &"a".repeat(27),
        ] {
            assert!(!valid_host(host), "{host}");
        }
    }

    #[test]
    fn legacy_and_host_names_retain_the_exact_nonce() {
        let nonce = "0123456789abcdef0123456789abcdef";
        for host in ["homelab", "homelab-macbook", "homelab-mac-mini"] {
            let name = attempt_name(host, nonce);
            assert_eq!(parse(&name), Some((host, nonce)));
            assert!(name.len() <= 63);
        }
        assert!(parse("homelab-macbook-job-short").is_none());
        assert!(parse("../homelab-job-0123456789abcdef0123456789abcdef").is_none());
    }

    #[test]
    fn remote_hosts_do_not_block_local_admission_but_legacy_names_do() {
        assert!(belongs_to_host("homelab-job-old", "homelab-macbook"));
        assert!(belongs_to_host(
            "homelab-macbook-job-new",
            "homelab-macbook"
        ));
        assert!(!belongs_to_host(
            "homelab-mac-mini-job-other",
            "homelab-macbook"
        ));
    }
}
