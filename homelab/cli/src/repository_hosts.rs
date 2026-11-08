//! Git defines host identity and its canonical local route; cache retains SSH key selection.
use crate::config::{Host, Manifest};
use crate::inventory::{HostProfile, validate_profile};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Connection {
    /// Effective connection, with the administrator taken from the selected Git revision.
    pub profile: HostProfile,
    /// Original cache entry for existing compare-and-swap inventory saves.
    pub cached: Option<HostProfile>,
}

impl Connection {
    /// The UI must review a changed Git login before saving or connecting.
    pub fn requires_review(&self) -> bool {
        self.cached
            .as_ref()
            .is_some_and(|cached| cached.user != self.profile.user)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostRow {
    pub configuration_host: String,
    pub connection: Result<Connection, Error>,
}

#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error(
        "More than one saved connection is bound to this Git host. Choose which connection to retain before continuing."
    )]
    Ambiguous,
    #[error(
        "The default connection name is already bound to a different Git host. Review the existing connection before continuing."
    )]
    NameConflict,
    #[error(
        "The Git host or saved connection is invalid. Reload the reviewed configuration and local connection cache."
    )]
    Invalid,
}

/// Only manifest hosts produce rows; stale local aliases do not become desired hosts.
pub fn rows(manifest: &Manifest, cache: &[HostProfile]) -> Vec<HostRow> {
    manifest
        .hosts
        .iter()
        .map(|(name, host)| HostRow {
            configuration_host: name.clone(),
            connection: resolve(name, host, cache),
        })
        .collect()
}

/// The caller supplies the selected revision's host. Resuming an approved setup
/// must use its saved, validated workspace, even if main removed or changed it.
pub fn resolve(name: &str, host: &Host, cache: &[HostProfile]) -> Result<Connection, Error> {
    if !crate::config::valid_host(name)
        || cache
            .iter()
            .any(|profile| validate_profile(profile).is_err())
    {
        return Err(Error::Invalid);
    }
    let mut matches = cache.iter().filter(|profile| {
        profile.configuration_host.as_deref() == Some(name)
            || (profile.configuration_host.is_none() && profile.name == name)
    });
    let cached = matches.next();
    if matches.next().is_some() {
        return Err(Error::Ambiguous);
    }
    if cached.is_none() && cache.iter().any(|profile| profile.name == name) {
        return Err(Error::NameConflict);
    }
    let mut profile = cached.cloned().unwrap_or_else(|| HostProfile {
        name: name.to_owned(),
        address: format!("{name}.local"),
        user: host.admin_user.clone(),
        identity: None,
        configuration_host: Some(name.to_owned()),
    });
    // Keep the original local name: existing setup journals are keyed by it.
    profile.user = host.admin_user.clone();
    profile.address = format!("{name}.local");
    profile.configuration_host = Some(name.to_owned());
    validate_profile(&profile).map_err(|_| Error::Invalid)?;
    Ok(Connection {
        profile,
        cached: cached.cloned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inventory::AgentIdentity;
    use std::collections::BTreeMap;

    fn host(admin: &str) -> Host {
        Host {
            admin_user: admin.into(),
            admin_uid: 501,
            authorized_keys: vec![],
            services: vec![],
        }
    }

    fn cached(name: &str, binding: Option<&str>) -> HostProfile {
        HostProfile {
            name: name.into(),
            address: "192.0.2.8".into(),
            user: "old-admin".into(),
            identity: None,
            configuration_host: binding.map(str::to_owned),
        }
    }

    #[test]
    fn explicit_alias_preserves_identity_and_journal_name_but_not_route_override() {
        let mut original = cached("my-server", Some("build-mac"));
        original.identity = Some(AgentIdentity {
            public_key: "ssh-ed25519 AAAA".into(),
            agent_socket: "/tmp/test-agent.sock".into(),
        });
        let resolved =
            resolve("build-mac", &host("admin"), std::slice::from_ref(&original)).unwrap();
        assert_eq!(resolved.profile.name, "my-server");
        assert_eq!(resolved.profile.address, "build-mac.local");
        assert_eq!(resolved.profile.identity, original.identity);
        assert_eq!(resolved.profile.user, "admin");
        assert!(resolved.requires_review());
        assert_eq!(resolved.cached, Some(original));
    }

    #[test]
    fn only_exact_unbound_legacy_name_is_inferred() {
        let original = cached("build-mac", None);
        let resolved =
            resolve("build-mac", &host("admin"), std::slice::from_ref(&original)).unwrap();
        assert!(resolved.requires_review());
        assert_eq!(resolved.cached, Some(original));
        assert_eq!(
            resolved.profile.configuration_host.as_deref(),
            Some("build-mac")
        );
        let new = resolve("build-mac", &host("admin"), &[cached("alias", None)]).unwrap();
        assert!(new.cached.is_none());
        assert_eq!(new.profile.address, "build-mac.local");
        assert_eq!(new.profile.name, "build-mac");
        assert_eq!(new.profile.user, "admin");
    }

    #[test]
    fn ambiguous_bindings_and_conflicting_names_are_not_guessed() {
        assert_eq!(
            resolve(
                "build-mac",
                &host("admin"),
                &[cached("one", Some("build-mac")), cached("build-mac", None)]
            ),
            Err(Error::Ambiguous)
        );
        let mut unchanged = cached("one", Some("build-mac"));
        unchanged.user = "admin".into();
        assert!(
            !resolve("build-mac", &host("admin"), &[unchanged])
                .unwrap()
                .requires_review()
        );
        assert_eq!(
            resolve(
                "build-mac",
                &host("admin"),
                &[
                    cached("one", Some("build-mac")),
                    cached("two", Some("build-mac"))
                ]
            ),
            Err(Error::Ambiguous)
        );
        assert_eq!(
            resolve(
                "build-mac",
                &host("admin"),
                &[cached("build-mac", Some("another-mac"))]
            ),
            Err(Error::NameConflict)
        );
    }

    #[test]
    fn current_git_rows_exclude_stale_cache_but_pinned_resume_keeps_original_admin() {
        let cache = vec![
            cached("old-alias", Some("removed-mac")),
            cached("build-mac", None),
        ];
        let current = Manifest {
            schema_url: None,
            schema: 1,
            one_password: None,
            hosts: BTreeMap::from([("build-mac".into(), host("new-admin"))]),
            tailscale: None,
        };
        let rows = rows(&current, &cache);
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].connection.as_ref().unwrap().profile.user,
            "new-admin"
        );
        let resumed = resolve("removed-mac", &host("approved-admin"), &cache).unwrap();
        assert_eq!(resumed.profile.user, "approved-admin");
        assert_eq!(resumed.profile.name, "old-alias");
    }

    #[test]
    fn invalid_routes_and_admins_fail_before_any_transport() {
        assert_eq!(
            resolve("build-mac", &host("-oProxyCommand=bad"), &[]),
            Err(Error::Invalid)
        );
        let mut invalid = cached("build-mac", None);
        invalid.address = "host; command".into();
        assert_eq!(
            resolve("build-mac", &host("admin"), &[invalid]),
            Err(Error::Invalid)
        );
    }
}
