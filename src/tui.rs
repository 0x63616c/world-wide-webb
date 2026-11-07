//! Select Git-defined hosts while retaining private connection and recovery state.

use std::io;
use std::path::Path;

use crossterm::cursor::{Hide, Show};
use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{self, EnterAlternateScreen, LeaveAlternateScreen};
use thiserror::Error;

use crate::inventory::{self, HostProfile, InventoryError};

pub(crate) struct Terminal {
    raw: bool,
    alternate: bool,
}

impl Terminal {
    pub(crate) fn enter() -> io::Result<Self> {
        let mut terminal = Self {
            raw: false,
            alternate: false,
        };
        terminal.resume()?;
        Ok(terminal)
    }

    pub(crate) fn resume(&mut self) -> io::Result<()> {
        if !self.raw {
            terminal::enable_raw_mode()?;
            self.raw = true;
        }
        if !self.alternate {
            // Mark before writing so partial failures still restore the terminal.
            self.alternate = true;
            execute!(io::stdout(), EnterAlternateScreen, Hide)?;
        }
        Ok(())
    }

    pub(crate) fn suspend(&mut self) -> io::Result<()> {
        let screen = if self.alternate {
            let result = execute!(io::stdout(), Show, LeaveAlternateScreen);
            if result.is_ok() {
                self.alternate = false;
            }
            result
        } else {
            Ok(())
        };
        // Restore input even if writing the screen transition failed.
        let input = if self.raw {
            let result = terminal::disable_raw_mode();
            if result.is_ok() {
                self.raw = false;
            }
            result
        } else {
            Ok(())
        };
        screen.and(input)
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        let _ = self.suspend();
    }
}

pub(crate) fn wrap(paragraphs: &[String], width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    for paragraph in paragraphs {
        if paragraph.trim().is_empty() {
            lines.push(String::new());
            continue;
        }
        let mut line = String::new();
        for word in paragraph.split_whitespace() {
            if !line.is_empty() && line.chars().count() + 1 + word.chars().count() > width {
                lines.push(std::mem::take(&mut line));
            }
            if !line.is_empty() {
                line.push(' ');
            }
            for character in word.chars() {
                if line.chars().count() == width {
                    lines.push(std::mem::take(&mut line));
                }
                line.push(character);
            }
        }
        if !line.is_empty() {
            lines.push(line);
        }
    }
    lines
}

pub(crate) fn footer(primary: &str, navigation: &str) -> String {
    format!("Enter: {primary} · {navigation}")
}

#[derive(Clone)]
struct Row {
    name: String,
    connection: Result<crate::repository_hosts::Connection, String>,
    resume: bool,
    missing_from_main: bool,
}

fn merge_rows(
    repository: &str,
    workspace: Option<&crate::config::Workspace>,
    cache: &[HostProfile],
    saved: Vec<(String, Result<crate::config::Workspace, String>)>,
) -> Vec<Row> {
    let mut rows = std::collections::BTreeMap::new();
    if let Some(workspace) = workspace {
        for row in crate::repository_hosts::rows(&workspace.manifest, cache) {
            rows.insert(
                row.configuration_host.clone(),
                Row {
                    name: row.configuration_host,
                    connection: row.connection.map_err(|error| error.to_string()),
                    resume: false,
                    missing_from_main: false,
                },
            );
        }
    }
    for (name, saved) in saved {
        let missing_from_main =
            workspace.is_some_and(|current| !current.manifest.hosts.contains_key(&name));
        let connection = saved.and_then(|workspace| {
            if workspace.repository != repository {
                return Err(
                    "The saved setup belongs to a different repository. Preserve its state.".into(),
                );
            }
            let host = workspace
                .manifest
                .hosts
                .get(&name)
                .ok_or("The approved configuration no longer contains this host.")?;
            crate::repository_hosts::resolve(&name, host, cache).map_err(|error| error.to_string())
        });
        rows.insert(
            name.clone(),
            Row {
                name,
                connection,
                resume: true,
                missing_from_main,
            },
        );
    }
    rows.into_values().collect()
}

fn load_rows(path: &Path, repository: &str) -> Result<(Vec<Row>, Option<String>), MenuError> {
    let cache = match inventory::load(path) {
        Ok(cache) => cache,
        Err(InventoryError::Missing) => Vec::new(),
        Err(error) => return Err(error.into()),
    };
    let current = crate::config::fetch(repository);
    let notice = current
        .as_ref()
        .err()
        .map(|_| "Main unavailable; saved setup only.".into());
    let mut saved = Vec::new();
    for profile in &cache {
        let name = profile
            .configuration_host
            .as_deref()
            .unwrap_or(&profile.name)
            .to_owned();
        match crate::setup_wizard::saved_installation_workspace(profile) {
            Ok(Some(workspace)) => saved.push((name, Ok(workspace))),
            Ok(None) => (),
            Err(_) => saved.push((name, Err("The saved approved configuration could not be loaded. Preserve this setup and check GitHub access.".into()))),
        }
    }
    Ok((
        merge_rows(repository, current.as_ref().ok(), &cache, saved),
        notice,
    ))
}

fn selected_row(rows: &[Row], selection: &str) -> Result<usize, MenuError> {
    let matches: Vec<_> = rows
        .iter()
        .enumerate()
        .filter(|(_, row)| {
            row.name == selection
                || row
                    .connection
                    .as_ref()
                    .is_ok_and(|connection| connection.profile.name == selection)
        })
        .map(|(index, _)| index)
        .collect();
    match matches.as_slice() {
        [index] => Ok(*index),
        _ => Err(MenuError::Selection),
    }
}

fn menu_lines(
    repository: &str,
    rows: &[Row],
    selected: usize,
    width: usize,
    height: usize,
) -> Vec<String> {
    let room = (height.saturating_sub(8) / 2).max(1);
    let start = selected.saturating_sub(room - 1);
    let content_width = width.saturating_sub(4).clamp(1, 76);
    let compact = |text: String| -> String {
        if text.chars().count() <= content_width {
            text
        } else {
            format!(
                "{}…",
                text.chars().take(content_width - 1).collect::<String>()
            )
        }
    };
    let mut lines = vec!["Homelab setup".into(), compact(repository.into())];
    for (index, row) in rows.iter().enumerate().skip(start).take(room) {
        lines.push(compact(format!(
            "{} {}{}",
            if index == selected { ">" } else { " " },
            row.name,
            if row.resume { " · Resume" } else { "" }
        )));
        if row.missing_from_main {
            lines.push("Saved setup (not in main)".into());
        }
    }
    if rows.is_empty() {
        lines.push("No hosts available. Check the repository configuration.".into());
    }
    lines
}

fn address_form(profile: &mut HostProfile, editing: bool) -> io::Result<bool> {
    let mut address = profile.address.clone();
    loop {
        let (width, _) = terminal::size()?;
        let room = usize::from(width).saturating_sub(6).clamp(1, 74);
        let tail = &address[address.len().saturating_sub(room)..];
        crate::setup_wizard::draw(
            &[
                if editing {
                    "Edit SSH address"
                } else {
                    "Connect to this Mac"
                }
                .into(),
                format!(
                    "{} · {}",
                    profile
                        .configuration_host
                        .as_deref()
                        .unwrap_or(&profile.name),
                    profile.user
                )
                .chars()
                .take(room + 2)
                .collect(),
                "SSH address".into(),
                format!("> {tail}"),
            ],
            0,
            &footer(
                if editing { "Save address" } else { "Connect" },
                "Ctrl-U clear · Esc back",
            ),
        )?;
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if key.kind == KeyEventKind::Release {
            continue;
        }
        match key.code {
            KeyCode::Esc => return Ok(false),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                return Ok(false);
            }
            KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => address.clear(),
            KeyCode::Char('\u{15}') => address.clear(),
            KeyCode::Backspace => {
                address.pop();
            }
            KeyCode::Char(character)
                if character.is_ascii_graphic()
                    && !key
                        .modifiers
                        .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
                    && address.len() < 253 =>
            {
                address.push(character)
            }
            KeyCode::Enter if crate::setup_wizard::usable_size()? => {
                let mut candidate = profile.clone();
                candidate.address = address.clone();
                if inventory::validate_profile(&candidate).is_ok() {
                    *profile = candidate;
                    return Ok(true);
                }
                crate::setup_wizard::review(
                    &[
                        "Check SSH address".into(),
                        "Use a hostname or IPv4 address without spaces or shell options.".into(),
                    ],
                    "Edit address",
                )?;
            }
            _ => (),
        }
    }
}

fn edit_address(path: &Path, row: &Row) -> io::Result<()> {
    let Ok(connection) = &row.connection else {
        return Ok(());
    };
    let Some(cached) = &connection.cached else {
        return Ok(());
    };
    let mut edited = connection.profile.clone();
    if !address_form(&mut edited, true)? {
        return Ok(());
    }
    // Editing a route does not approve a changed Git administrator.
    let mut updated = cached.clone();
    updated.address = edited.address;
    updated.configuration_host = Some(row.name.clone());
    if let Err(error) = inventory::save_connection(path, Some(cached), updated) {
        crate::setup_wizard::review(
            &[
                "Address not saved".into(),
                error.to_string(),
                error.next_action().into(),
            ],
            "Back",
        )?;
    }
    Ok(())
}

fn prepare_connection(path: &Path, row: &Row) -> io::Result<Option<HostProfile>> {
    let mut connection = match &row.connection {
        Ok(connection) => connection.clone(),
        Err(error) => {
            crate::setup_wizard::review(
                &["Connection needs attention".into(), error.clone()],
                "Back",
            )?;
            return Ok(None);
        }
    };
    if connection.cached.is_none() && !address_form(&mut connection.profile, false)? {
        return Ok(None);
    }
    if connection.requires_review() {
        let old = connection
            .cached
            .as_ref()
            .expect("review requires existing connection");
        if !crate::setup_wizard::review(
            &[
                "Administrator changed in Git".into(),
                format!("{} · {}", row.name, connection.profile.address),
                format!("Saved login: {}", old.user),
                format!("Git login: {}", connection.profile.user),
                "Use the reviewed Git administrator for this connection. No account is renamed."
                    .into(),
            ],
            "Use Git administrator",
        )? {
            return Ok(None);
        }
    }
    match inventory::save_connection(path, connection.cached.as_ref(), connection.profile) {
        Ok(profile) => Ok(Some(profile)),
        Err(error) => {
            crate::setup_wizard::review(
                &[
                    "Connection not saved".into(),
                    error.to_string(),
                    error.next_action().into(),
                ],
                "Back",
            )?;
            Ok(None)
        }
    }
}

#[derive(Debug, Error)]
pub enum MenuError {
    #[error("{0}")]
    Inventory(#[from] InventoryError),
    #[error("The terminal menu could not continue.")]
    Terminal,
    #[error(
        "The attached repository could not be loaded. Check GitHub access and saved configuration."
    )]
    Configuration,
    #[error("Choose a Git host or an unambiguous saved connection for an approved setup.")]
    Selection,
    #[error("Setup cancelled. Existing saved progress is preserved.")]
    Cancelled,
    #[error("Setup did not complete. Review the result above before retrying.")]
    Incomplete,
}

impl From<io::Error> for MenuError {
    fn from(_: io::Error) -> Self {
        Self::Terminal
    }
}

pub fn launch(path: &Path) -> Result<(), MenuError> {
    launch_selected(path, None)
}

/// Git provides the host list; local connections only remember trusted routes.
pub fn launch_selected(path: &Path, selection: Option<&str>) -> Result<(), MenuError> {
    let mut terminal_guard = Terminal::enter()?;
    let binding = path.with_file_name("repository.json");
    let repository =
        match crate::config::attached_repository(&binding).map_err(|_| MenuError::Configuration)? {
            Some(repository) => repository,
            None => match crate::setup_wizard::attached_workspace(&binding)? {
                Some(workspace) => workspace.repository,
                None => {
                    return if selection.is_some() {
                        Err(MenuError::Cancelled)
                    } else {
                        Ok(())
                    };
                }
            },
        };
    let mut canonical_selection = None;
    let mut direct = selection;
    loop {
        crate::setup_wizard::draw(
            &["Loading Git hosts".into(), repository.clone()],
            0,
            "Please wait",
        )?;
        let (rows, notice) = load_rows(path, &repository)?;
        let mut selected = if let Some(selection) = direct {
            selected_row(&rows, selection)?
        } else {
            canonical_selection
                .as_ref()
                .and_then(|name| rows.iter().position(|row| &row.name == name))
                .unwrap_or(0)
        };
        let mut editing = false;
        let row = loop {
            if direct.is_some() {
                break rows.get(selected).cloned();
            }
            let (width, height) = terminal::size()?;
            let mut lines = menu_lines(
                &repository,
                &rows,
                selected,
                usize::from(width),
                usize::from(height).saturating_sub(usize::from(notice.is_some())),
            );
            if let Some(notice) = &notice {
                lines.push(notice.clone());
            }
            let editable = rows.get(selected).is_some_and(|row| {
                row.connection
                    .as_ref()
                    .is_ok_and(|connection| connection.cached.is_some())
            });
            crate::setup_wizard::draw(
                &lines,
                0,
                &footer(
                    "Set up",
                    if editable {
                        "↑/↓ choose · e Edit address · q quit"
                    } else {
                        "↑/↓ choose · q quit"
                    },
                ),
            )?;
            let Event::Key(key) = event::read()? else {
                continue;
            };
            if key.kind == KeyEventKind::Release {
                continue;
            }
            match key.code {
                KeyCode::Esc | KeyCode::Char('q') => return Ok(()),
                KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    return Ok(());
                }
                KeyCode::Char('e') if editable && crate::setup_wizard::usable_size()? => {
                    editing = true;
                    break rows.get(selected).cloned();
                }
                KeyCode::Up if !rows.is_empty() => {
                    selected = (selected + rows.len() - 1) % rows.len()
                }
                KeyCode::Down if !rows.is_empty() => selected = (selected + 1) % rows.len(),
                KeyCode::Enter if crate::setup_wizard::usable_size()? => {
                    break rows.get(selected).cloned();
                }
                _ => (),
            }
        };
        let Some(row) = row else {
            continue;
        };
        canonical_selection = Some(row.name.clone());
        if editing {
            edit_address(path, &row)?;
            continue;
        }
        let Some(profile) = prepare_connection(path, &row)? else {
            if direct.is_some() {
                return Err(MenuError::Cancelled);
            }
            continue;
        };
        let outcome = crate::setup_wizard::launch_in_terminal(&profile, path, &mut terminal_guard)?;
        if direct.take().is_some() {
            terminal_guard.suspend()?;
            println!("{}", outcome.lines.join("\n"));
            return if outcome.completed {
                Ok(())
            } else {
                Err(MenuError::Incomplete)
            };
        }
        terminal_guard.resume()?;
        crate::setup_wizard::review(&outcome.lines, "Back to hosts")?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Host, Manifest, Workspace};
    use std::collections::BTreeMap;

    fn workspace(name: &str, admin: &str) -> Workspace {
        Workspace {
            repository: "example/config".into(),
            revision: "a".repeat(40),
            manifest: Manifest {
                schema_url: None,
                schema: 1,
                one_password: None,
                tailscale: None,
                hosts: BTreeMap::from([(
                    name.into(),
                    Host {
                        admin_user: admin.into(),
                        admin_uid: 501,
                        authorized_keys: vec![],
                        activation_ready: false,
                        services: vec![],
                    },
                )]),
            },
        }
    }
    fn cached() -> HostProfile {
        HostProfile {
            name: "old-alias".into(),
            address: "192.0.2.1".into(),
            user: "original-admin".into(),
            identity: None,
            configuration_host: Some("build-mac".into()),
        }
    }
    #[test]
    fn approved_revision_overrides_current_admin_and_survives_removed_main_host() {
        let cache = vec![cached()];
        for current in [
            Some(workspace("build-mac", "new-admin")),
            Some(workspace("other-mac", "new-admin")),
            None,
        ] {
            let rows = merge_rows(
                "example/config",
                current.as_ref(),
                &cache,
                vec![(
                    "build-mac".into(),
                    Ok(workspace("build-mac", "original-admin")),
                )],
            );
            let row = rows.iter().find(|row| row.name == "build-mac").unwrap();
            assert!(row.resume);
            let profile = &row.connection.as_ref().unwrap().profile;
            assert_eq!(profile.user, "original-admin");
            assert_eq!(profile.name, "old-alias");
            assert_eq!(profile.address, "192.0.2.1");
        }
    }
    #[test]
    fn removed_saved_host_is_labeled_but_unavailable_main_is_not_guessed() {
        for (current, removed) in [
            (Some(workspace("other-mac", "admin")), true),
            (Some(workspace("build-mac", "admin")), false),
            (None, false),
        ] {
            let rows = merge_rows(
                "example/config",
                current.as_ref(),
                &[cached()],
                vec![(
                    "build-mac".into(),
                    Ok(workspace("build-mac", "original-admin")),
                )],
            );
            let selected = selected_row(&rows, "build-mac").unwrap();
            assert_eq!(rows[selected].missing_from_main, removed);
            let lines = menu_lines("example/config", &rows, selected, 40, 12);
            assert_eq!(
                lines.iter().any(|line| line == "Saved setup (not in main)"),
                removed
            );
        }
    }

    #[test]
    fn unavailable_approved_revision_cannot_fall_back_to_new_enrollment() {
        let current = workspace("build-mac", "new-admin");
        let rows = merge_rows(
            "example/config",
            Some(&current),
            &[cached()],
            vec![("build-mac".into(), Err("Unavailable".into()))],
        );
        assert!(rows[0].connection.is_err());
        let mut other = workspace("build-mac", "original-admin");
        other.repository = "other/config".into();
        let rows = merge_rows(
            "example/config",
            Some(&current),
            &[cached()],
            vec![("build-mac".into(), Ok(other))],
        );
        assert!(rows[0].connection.is_err());
    }
    #[test]
    fn selectors_accept_canonical_or_unambiguous_legacy_alias_only() {
        let current = workspace("build-mac", "original-admin");
        let rows = merge_rows("example/config", Some(&current), &[cached()], vec![]);
        assert_eq!(selected_row(&rows, "build-mac").unwrap(), 0);
        assert_eq!(selected_row(&rows, "old-alias").unwrap(), 0);
        assert!(selected_row(&rows, "192.0.2.1").is_err());
        assert!(selected_row(&rows, "unknown").is_err());
    }
    #[test]
    fn legacy_exact_name_preserves_agent_identity_and_binds_only_on_save() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("private/inventory.json");
        let original = HostProfile {
            name: "build-mac".into(),
            address: "build-mac.local".into(),
            user: "admin".into(),
            identity: Some(crate::inventory::AgentIdentity {
                public_key: "ssh-ed25519 AAAA".into(),
                agent_socket: "/tmp/synthetic-agent.sock".into(),
            }),
            configuration_host: None,
        };
        inventory::add(&path, original.clone()).unwrap();
        let before = std::fs::read(&path).unwrap();
        let current = workspace("build-mac", "admin");
        let rows = merge_rows(
            "example/config",
            Some(&current),
            std::slice::from_ref(&original),
            vec![],
        );
        let connection = rows[0].connection.as_ref().unwrap();
        assert!(
            connection.cached.is_some(),
            "cached route must skip address form"
        );
        assert!(!connection.requires_review());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        let saved = inventory::save_connection(
            &path,
            connection.cached.as_ref(),
            connection.profile.clone(),
        )
        .unwrap();
        assert_eq!(saved.identity, original.identity);
        assert_eq!(saved.name, original.name);
        assert_eq!(saved.address, original.address);
        assert_eq!(saved.user, original.user);
        assert_eq!(saved.configuration_host.as_deref(), Some("build-mac"));
    }

    #[test]
    fn selected_long_git_host_and_actions_fit_minimum_menu() {
        let current = workspace(&"x".repeat(100), "admin");
        let mut rows = merge_rows("example/config", Some(&current), &[], vec![]);
        for index in 0..31 {
            let current = workspace(&format!("host-{index}"), "admin");
            rows.extend(merge_rows("example/config", Some(&current), &[], vec![]));
        }
        for selected in [0, 31] {
            let lines = menu_lines(&"x".repeat(100), &rows, selected, 40, 12);
            assert!(lines.iter().any(|line| line.starts_with("> ")));
            assert!(lines.iter().all(|line| line.chars().count() <= 36));
            assert!(lines.len() <= 6);
        }
    }

    #[test]
    fn long_text_wraps_without_loss() {
        let word = "x".repeat(253);
        assert_eq!(wrap(std::slice::from_ref(&word), 36).concat(), word);
    }
}
