//! Guided setup with administrator input kept inside the masked form.
use crate::ui::actions::Action;
#[path = "ui/checklist.rs"]
mod checklist;
use checklist::{Checklist, Step};

use std::io;
use std::path::{Path, PathBuf};

use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use crossterm::terminal;

use crate::inventory::{self, AgentIdentity, HostProfile};
use crate::remote_setup::{self, Request};
use crate::tui::{Terminal, footer, wrap};
use crate::ui::{self, Role};
use crate::{config, first_access, inspect, package};

fn render(
    title: &str,
    body: &[(String, Role)],
    offset: usize,
    footer: &[Action],
) -> io::Result<usize> {
    render_with_link(title, body, offset, footer, None)
}

fn render_with_link(
    title: &str,
    body: &[(String, Role)],
    offset: usize,
    footer: &[Action],
    link: Option<&str>,
) -> io::Result<usize> {
    if let Some(url) = link {
        let mut linked_body = body.to_vec();
        linked_body.push((url.to_owned(), Role::Action));
        ui::render(title, &linked_body, offset, footer)
    } else {
        ui::render(title, body, offset, footer)
    }
}

pub(crate) fn draw(lines: &[String], offset: usize, footer: &[Action]) -> io::Result<usize> {
    let Some((title, body)) = lines.split_first() else {
        return Ok(0);
    };
    let body = body
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, line)| {
            let role = if line.starts_with("Repo: ") {
                Role::Repository
            } else if line.starts_with("> ") {
                Role::Selected
            } else if line.starts_with("    ") {
                if index > 0 && body[index - 1].starts_with("> ") {
                    Role::SelectedDetail
                } else {
                    Role::ListDetail
                }
            } else if line.starts_with("  ") {
                Role::ListOption
            } else if line.starts_with("✓ ") {
                Role::Success
            } else if line.starts_with("Configuration: ") || line.starts_with("SSH: ") {
                Role::Field
            } else if crate::host_status::Status::is_label(&line) {
                Role::Hint
            } else if line.starts_with("! ") {
                Role::Warning
            } else if line.ends_with(':') && line.len() <= 32 {
                Role::Section
            } else if index == 0 {
                Role::Context
            } else {
                Role::Body
            };
            (line, role)
        })
        .collect::<Vec<_>>();
    render(title, &body, offset, footer)
}

pub(crate) fn key() -> io::Result<KeyCode> {
    if crate::quit::requested() {
        return Ok(KeyCode::Esc);
    }
    loop {
        let event = event::read()?;
        if matches!(event, Event::Resize(..)) {
            return Ok(KeyCode::Null);
        }
        if let Event::Key(key) = event {
            if key.kind == event::KeyEventKind::Release {
                continue;
            }
            let code = crate::quit::handle(key);
            if code == KeyCode::Null || crate::quit::requested() {
                return Ok(code);
            }
            if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('u') {
                return Ok(KeyCode::Char('\u{15}'));
            }
            if !key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
            {
                return Ok(key.code);
            }
        }
    }
}

pub struct Outcome {
    pub lines: Vec<String>,
    /// The requested stage succeeded; access-only completion does not mean activation.
    pub completed: bool,
}

#[derive(Clone, Copy, Default)]
struct AccessChanges {
    trust_attempted: bool,
    key_attempted: bool,
    identity_saved: bool,
}

impl AccessChanges {
    fn append_notice(self, lines: &mut Vec<String>) {
        if self.identity_saved {
            lines.push("Your SSH identity preference was saved on this Mac.".into());
        }
        if self.trust_attempted {
            lines.push("A first-use SSH host key may have been saved on your Mac. It has not been removed.".into());
        }
        if self.key_attempted {
            lines.push(
                "Your public key may have been installed on the target. It has not been removed."
                    .into(),
            );
        }
    }
}

fn cancelled(changes: AccessChanges) -> Outcome {
    let mut lines = vec![
        "Setup cancelled. No bootstrap credentials were transferred and no host configuration was activated.".into(),
    ];
    changes.append_notice(&mut lines);
    Outcome {
        lines,
        completed: false,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AccessAction {
    Check,
    Trust,
    InstallKey,
}

impl AccessAction {
    fn label(self) -> &'static str {
        match self {
            Self::Check => "Check SSH access",
            Self::Trust => "Confirm this Mac",
            Self::InstallKey => "Connect with 1Password",
        }
    }
}

fn failure_screen(error: &first_access::Error) -> (&'static str, &'static str, Vec<AccessAction>) {
    use AccessAction::{Check, InstallKey, Trust};
    use first_access::Error;
    match error {
        Error::HostUnknown => (
            "First connection to this Mac",
            "Confirm this is the Mac you just set up.",
            vec![Trust, Check],
        ),
        Error::HostChanged => (
            "! Saved SSH identity changed",
            "Verify the target locally. Do not remove the saved key to bypass this warning.",
            vec![Check],
        ),
        Error::AuthenticationDenied => (
            "SSH key not accepted",
            "Use the target password to add a key.",
            vec![InstallKey, Check],
        ),
        Error::ConnectionRefused => (
            "Remote Login unavailable",
            "Enable Remote Login for the Git administrator on the target Mac.",
            vec![Check],
        ),
        Error::ConnectionTimeout => (
            "The Mac did not respond",
            "Check the target is awake and on the same reachable network.",
            vec![Check],
        ),
        Error::NameResolution => (
            "Address not found",
            "Set the Mac’s local hostname to its Git host name, then connect from the same local network.",
            vec![Check],
        ),
        Error::AgentRefused => (
            "SSH agent approval needed",
            "Open and unlock your SSH agent, approve this connection, then retry. The key may already be installed.",
            vec![Check],
        ),
        Error::Verification => (
            "Key installed; login not verified",
            "Make its private key available to your SSH agent or configuration, then retry.",
            vec![Check],
        ),
        Error::Installation | Error::UnknownOutcome => (
            "Key installation not confirmed",
            "Check the target's authorized_keys before retrying installation.",
            vec![Check, InstallKey],
        ),
        _ => (
            "Connection not verified",
            "Check Remote Login, the Mac’s local hostname and your network.",
            vec![Check, InstallKey],
        ),
    }
}

pub(crate) fn choose(lines: &[String], actions: &[&str]) -> io::Result<Option<usize>> {
    let mut selected = 0;
    let (width, height) = terminal::size()?;
    let prose_room = usize::from(height).saturating_sub(8 + actions.len());
    if wrap(&lines[1..], ui::content_width(width)).len() > prose_room
        && !review(lines, "Continue to choices")?
    {
        return Ok(None);
    }
    loop {
        let (width, height) = terminal::size()?;
        let width = ui::content_width(width);
        let room = usize::from(height).saturating_sub(7);
        let action_rows = actions.len() + 1;
        let prose = wrap(&lines[1..], width);
        let prose_room = room.saturating_sub(action_rows);
        let mut content: Vec<_> = prose
            .into_iter()
            .take(prose_room)
            .map(|line| (line, Role::Body))
            .collect();
        content.push((String::new(), Role::Body));
        content.extend(actions.iter().enumerate().map(|(index, label)| {
            (
                format!("{} {label}", if index == selected { ">" } else { " " }),
                if index == selected {
                    Role::Selected
                } else {
                    Role::ListOption
                },
            )
        }));
        let navigation: &[Action] = if actions.len() > 1 {
            &[Action::Navigation, Action::Help, Action::Back]
        } else {
            &[Action::Help, Action::Back]
        };
        ui::render_selected(&lines[0], &content, &footer("Select", navigation))?;
        match key()? {
            code if Action::Help.matches(code) => ui::help()?,
            code if Action::Back.matches(code) => return Ok(None),
            KeyCode::Enter if usable_size()? => return Ok(Some(selected)),
            KeyCode::Up => {
                selected = selected.saturating_sub(1);
            }
            KeyCode::Down => {
                selected = (selected + 1).min(actions.len() - 1);
            }
            // Retain visible actions for users accustomed to the old shortcuts.
            KeyCode::Char(character) => {
                let label = match character.to_ascii_lowercase() {
                    'k' => "Connect with 1Password",
                    't' => "Confirm this Mac",
                    _ => "",
                };
                if let Some(index) = actions.iter().position(|action| *action == label)
                    && usable_size()?
                {
                    return Ok(Some(index));
                }
            }
            _ => {}
        }
    }
}

pub(crate) fn review(lines: &[String], primary: &str) -> io::Result<bool> {
    review_screen(primary, |offset, actions| draw(lines, offset, actions))
}

pub(crate) fn review_content(
    title: &str,
    body: &[(String, Role)],
    primary: &str,
) -> io::Result<bool> {
    review_screen(primary, |offset, actions| {
        render(title, body, offset, actions)
    })
}

fn review_enter_result(primary: &str, offset: usize, last: usize) -> Option<bool> {
    if primary.is_empty() {
        Some(false)
    } else if offset >= last {
        Some(true)
    } else {
        None
    }
}

fn review_screen(
    primary: &str,
    mut draw: impl FnMut(usize, &[Action]) -> io::Result<usize>,
) -> io::Result<bool> {
    let mut offset = 0;
    loop {
        // Approval uses the viewport actually shown; changing footer height
        // between measurement and drawing can otherwise hide the final lines.
        let last = draw(
            offset,
            &footer(primary, &[Action::Navigation, Action::Help, Action::Back]),
        )?;
        match key()? {
            code if Action::Help.matches(code) => ui::help()?,
            code if Action::Back.matches(code) => return Ok(false),
            KeyCode::Down | KeyCode::PageDown => offset = (offset + 1).min(last),
            KeyCode::Up | KeyCode::PageUp => offset = offset.saturating_sub(1),
            KeyCode::Enter if usable_size()? => match review_enter_result(primary, offset, last) {
                Some(result) => return Ok(result),
                None => offset = (offset + 3).min(last),
            },
            _ => {}
        }
    }
}

struct SelectedKey {
    key: first_access::PublicKey,
    identity: Option<AgentIdentity>,
}

fn agent_key_lines(
    keys: &[(&str, &str)],
    selected: usize,
    width: usize,
    room: usize,
) -> Vec<String> {
    let fingerprint_rows = wrap(&[keys[selected].1.into()], width).len();
    let count = (room.saturating_sub(2) / (fingerprint_rows + 1))
        .max(1)
        .min(keys.len());
    let start = selected
        .saturating_sub(count - 1)
        .min(keys.len().saturating_sub(count));
    let mut lines = vec!["Choose a 1Password key".into()];
    for (index, (label, fingerprint)) in keys.iter().enumerate().skip(start).take(count) {
        let label = if label.is_empty() {
            "Unnamed SSH key"
        } else {
            label
        };
        let name: String = label.chars().take(width.saturating_sub(2)).collect();
        lines.push(format!(
            "{} {name}",
            if index == selected { ">" } else { " " }
        ));
        lines.push(format!("    {fingerprint}"));
    }
    lines
}

fn select_agent_key(mut keys: Vec<first_access::AgentKey>) -> io::Result<Option<SelectedKey>> {
    if keys.is_empty() {
        return Ok(None);
    }
    if keys.len() == 1 {
        let key = keys.remove(0);
        let identity = key.identity();
        return Ok(Some(SelectedKey {
            key: key.into_public_key(),
            identity: Some(identity),
        }));
    }
    let mut selected = 0;
    loop {
        let (width, height) = terminal::size()?;
        let labels: Vec<_> = keys
            .iter()
            .map(|key| (key.label(), key.fingerprint()))
            .collect();
        let lines = agent_key_lines(
            &labels,
            selected,
            usize::from(width).saturating_sub(4).clamp(1, 76),
            usize::from(height).saturating_sub(7),
        );
        draw(
            &lines,
            0,
            &footer("Review this key", &[Action::Navigation, Action::Back]),
        )?;
        match key()? {
            code if Action::Back.matches(code) => return Ok(None),
            KeyCode::Up => selected = selected.saturating_sub(1),
            KeyCode::Down => selected = (selected + 1).min(keys.len() - 1),
            KeyCode::Enter if usable_size()? => {
                let key = keys.remove(selected);
                let identity = key.identity();
                return Ok(Some(SelectedKey {
                    key: key.into_public_key(),
                    identity: Some(identity),
                }));
            }
            _ => {}
        }
    }
}

fn choose_key_source(tools: &first_access::Tools) -> io::Result<Option<SelectedKey>> {
    let Some(socket) = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join("Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock"))
    else {
        return Ok(None);
    };
    loop {
        let result = ui::loading::run(
            || {
                render(
                    "Connecting with 1Password",
                    &[
                        ("Reading your SSH keys…".into(), Role::Working),
                        (String::new(), Role::Body),
                        ("Approve the request in 1Password.".into(), Role::Context),
                    ],
                    0,
                    &[Action::Quit],
                )
                .map(|_| ())
            },
            || first_access::list_agent_keys(&socket, tools),
        )?;
        if crate::quit::requested() {
            return Ok(None);
        }
        match result {
            Ok(keys) => return select_agent_key(keys),
            Err(_) => {
                if choose(
                    &[
                        "Connect with 1Password".into(),
                        "Unlock 1Password and enable its SSH agent.".into(),
                    ],
                    &["Try again"],
                )? != Some(0)
                {
                    return Ok(None);
                }
            }
        }
    }
}

enum AccessOutcome {
    Continue(AccessChanges),
    Finished(Outcome),
}

fn installation_required(
    check: Result<(), first_access::Error>,
) -> Result<bool, first_access::Error> {
    match check {
        Ok(()) => Ok(false),
        Err(first_access::Error::AuthenticationDenied) => Ok(true),
        Err(error) => Err(error),
    }
}

#[derive(Clone, Copy)]
enum ConnectionStage {
    Connecting,
    Inspecting,
}

fn connection_progress(profile: &HostProfile, stage: ConnectionStage) -> io::Result<()> {
    use crate::ui::components::ProgressState;
    let (connection, inspection) = match stage {
        ConnectionStage::Connecting => (
            ProgressState::Running.row("Connecting over SSH"),
            ProgressState::Pending.row("Check Mac"),
        ),
        ConnectionStage::Inspecting => (
            ProgressState::Complete.row("Connected over SSH"),
            ProgressState::Running.row("Checking Mac"),
        ),
    };
    render(
        &format!("Connecting to {}", profile.name),
        &[
            (
                format!("{}@{}", profile.user, profile.address),
                Role::Context,
            ),
            (String::new(), Role::Body),
            connection,
            inspection,
        ],
        0,
        &[Action::Quit],
    )?;
    Ok(())
}

fn connect(
    profile: &mut HostProfile,
    inventory_path: &Path,
    tools: &first_access::Tools,
    _terminal: &mut Terminal,
) -> io::Result<AccessOutcome> {
    let mut changes = AccessChanges::default();
    let mut existing_access_worked = false;
    let mut screen = Vec::new();
    let mut first_check = true;
    let mut actions = vec![AccessAction::Check];
    loop {
        let labels: Vec<_> = actions.iter().map(|action| action.label()).collect();
        let selected = if first_check {
            first_check = false;
            0
        } else {
            let Some(selected) = choose(&screen, &labels)? else {
                return Ok(AccessOutcome::Finished(cancelled(changes)));
            };
            selected
        };
        let result = match actions[selected] {
            AccessAction::Check | AccessAction::Trust => {
                let trust = if actions[selected] == AccessAction::Trust {
                    if !review(
                        &[
                            "Connect to this Mac?".into(),
                            format!("{}@{}", profile.user, profile.address),
                            String::new(),
                            "Confirm this is the Mac you just set up.".into(),
                            "Remember this Mac for future connections.".into(),
                        ],
                        "Connect",
                    )? {
                        continue;
                    }
                    changes.trust_attempted = true;
                    first_access::Trust::AcceptNew
                } else {
                    first_access::Trust::Strict
                };
                ui::loading::run(
                    || connection_progress(profile, ConnectionStage::Connecting),
                    || first_access::check_key_access(profile, tools, trust),
                )?
            }
            AccessAction::InstallKey => {
                let Some(selected_key) = choose_key_source(tools)? else {
                    continue;
                };
                let is_agent = selected_key.identity.is_some();
                if !review(
                    &[
                        "Allow access to this Mac?".into(),
                        format!("{}@{}", profile.user, profile.address),
                        String::new(),
                        "Connect using your 1Password SSH key.".into(),
                        "Enter the Mac’s password if asked.".into(),
                    ],
                    "Connect",
                )? {
                    continue;
                }
                match inventory::set_identity(inventory_path, profile, selected_key.identity) {
                    Ok(updated) => { *profile = updated; changes.identity_saved = true; }
                    Err(error) => return Ok(AccessOutcome::Finished(Outcome {
                        lines: vec!["SSH identity selection was not saved.".into(), error.to_string(), error.next_action().into(), "No public key was installed. Return to the menu and reload the profile.".into()],
                        completed: false,
                    })),
                }
                let required = if is_agent {
                    installation_required(ui::loading::run(
                        || connection_progress(profile, ConnectionStage::Connecting),
                        || {
                            first_access::check_key_access(
                                profile,
                                tools,
                                first_access::Trust::Strict,
                            )
                        },
                    )?)
                } else {
                    // A configured default key cannot prove this chosen file's identity.
                    Ok(true)
                };
                match required {
                    Ok(false) => {
                        existing_access_worked = true;
                        Ok(())
                    }
                    Err(error) => Err(error),
                    Ok(true) => {
                        changes.key_attempted = true;
                        crate::terminal_process::within(
                            "Connecting to your Mac",
                            &profile.name,
                            || first_access::install_public_key(profile, tools, &selected_key.key),
                        )
                    }
                }
            }
        };
        if let Err(error) = result {
            let (title, message, next) = failure_screen(&error);
            screen = vec![
                "How do you want to connect?".into(),
                format!("{}@{}", profile.user, profile.address),
                title.into(),
                message.into(),
            ];
            actions = next;
            continue;
        }
        if crate::quit::requested() {
            return Ok(AccessOutcome::Finished(cancelled(changes)));
        }
        let inspection = match ui::loading::run(
            || connection_progress(profile, ConnectionStage::Inspecting),
            || inspect::inspect(profile, &tools.ssh),
        )? {
            Ok(inspection) => inspection,
            Err(error) => {
                screen = vec![
                    "Access works; inspection failed".into(),
                    error.to_string(),
                    error.next_action().into(),
                ];
                actions = vec![AccessAction::Check];
                continue;
            }
        };
        if inspection.is_ready() {
            if !review(
                &[
                    format!("Connecting to {}", profile.name),
                    format!("{}@{}", profile.user, profile.address),
                    String::new(),
                    "✓ Connected over SSH".into(),
                    "✓ Mac checked".into(),
                ],
                "Continue",
            )? {
                return Ok(AccessOutcome::Finished(cancelled(changes)));
            }
            return Ok(AccessOutcome::Continue(changes));
        }
        let mut lines = vec![
            "SSH access verified".into(),
            format!("macOS {} | {}", inspection.mac_os, inspection.architecture),
            format!(
                "{} (UID {}) | {}",
                inspection.user,
                inspection.uid,
                inspection.storage_label()
            ),
            "Host setup has not started.".into(),
        ];
        if existing_access_worked {
            lines.push("Existing SSH access worked. No public key was installed.".into());
        }
        if !inspection.is_ready() {
            lines.push("! Bootstrap requires an Apple-silicon Mac.".into());
        }
        changes.append_notice(&mut lines);
        return Ok(AccessOutcome::Finished(Outcome {
            lines,
            completed: false,
        }));
    }
}

pub(crate) fn usable_size() -> io::Result<bool> {
    let (width, height) = terminal::size()?;
    Ok(width >= 40 && height >= 12)
}

pub(crate) fn repository_progress(repository: &str) -> io::Result<()> {
    render(
        "Opening homelab",
        &[
            (format!("Repo: {repository}"), Role::Repository),
            ("› Reading configuration".into(), Role::Working),
        ],
        0,
        &[Action::Quit],
    )?;
    Ok(())
}

pub(crate) fn configuration_loaded(repository: &str) -> io::Result<()> {
    let until = std::time::Instant::now() + std::time::Duration::from_secs(1);
    while std::time::Instant::now() < until && !crate::quit::requested() {
        render(
            "Opening homelab",
            &[
                (format!("Repo: {repository}"), Role::Repository),
                ("✓ Configuration loaded".into(), Role::Success),
            ],
            0,
            &[Action::Quit],
        )?;
        if event::poll(std::time::Duration::from_millis(40))?
            && let Event::Key(key) = event::read()?
        {
            crate::quit::handle(key);
        }
    }
    Ok(())
}

pub(crate) fn completed_lines(host: &str, revision: &str, dns_name: &str) -> Vec<String> {
    vec![
        format!("{host} is set up!"),
        "✓ Configuration installed".into(),
        "✓ Reboot and remote access verified".into(),
        "✓ Automatic Git updates enabled".into(),
        String::new(),
        format!("Configuration: #{}", revision.get(..8).unwrap_or(revision)),
        format!("Tailscale: {dns_name}"),
    ]
}

pub(crate) fn success(lines: &[String], repository: &str) -> io::Result<()> {
    let started = std::time::Instant::now();
    let mut offset = 0usize;
    loop {
        let mut body = vec![
            (format!("Repo: {repository}"), Role::Repository),
            (
                format!(" {} ", lines.first().map_or("All set!", String::as_str)),
                Role::SuccessTitle,
            ),
            (String::new(), Role::Body),
        ];
        body.extend(lines.iter().skip(1).map(|line| {
            (
                line.clone(),
                if line.starts_with('✓') {
                    Role::Success
                } else {
                    Role::Field
                },
            )
        }));
        if let Some(sha) = lines
            .iter()
            .find_map(|line| line.strip_prefix("Configuration: #"))
        {
            body.push((format!("{repository}#{sha}"), Role::Commit));
        }
        if terminal::size()?.1 < 18 {
            body.retain(|(text, _)| !text.is_empty());
        }
        let last = ui::render_success(&body, started.elapsed(), offset)?;
        offset = offset.min(last);
        if event::poll(std::time::Duration::from_millis(40))?
            && let Event::Key(event) = event::read()?
        {
            match crate::quit::handle(event) {
                KeyCode::Enter if usable_size()? => return Ok(()),
                KeyCode::Up => offset = offset.saturating_sub(1),
                KeyCode::Down => offset = (offset + 1).min(last),
                _ if crate::quit::requested() => return Ok(()),
                _ => {}
            }
        }
    }
}

pub(crate) fn attached_workspace(path: &Path) -> io::Result<Option<config::Workspace>> {
    match config::load(path) {
        Ok(Some(workspace)) => return Ok(Some(workspace)),
        Ok(None) => {}
        Err(error) => {
            review(
                &[
                    "Configuration unavailable".into(),
                    error.to_string(),
                    "Check local GitHub CLI authentication and the repository manifest.".into(),
                ],
                "Return",
            )?;
            return Ok(None);
        }
    }
    let mut repository = String::new();
    loop {
        render(
            "Which repo do you want to use?",
            &[if repository.is_empty() {
                ("owner/repo".into(), Role::Placeholder)
            } else {
                (repository.clone(), Role::Input)
            }],
            0,
            &footer("Continue", &[Action::Clear, Action::Back]),
        )?;
        match key()? {
            code if Action::Back.matches(code) => return Ok(None),
            KeyCode::Backspace => {
                repository.pop();
            }
            KeyCode::Char('\u{15}') => repository.clear(),
            KeyCode::Char(character) if character.is_ascii_graphic() && repository.len() < 512 => {
                repository.push(character)
            }
            KeyCode::Enter if usable_size()? => {
                let result = ui::loading::run(
                    || repository_progress(&repository),
                    || {
                        config::parse_repository(&repository)
                            .and_then(|name| config::attach(&name, path))
                    },
                )?;
                if crate::quit::requested() {
                    return Ok(None);
                }
                match result {
                    Ok(workspace) => return Ok(Some(workspace)),
                    Err(error) => {
                        review(
                            &[
                                "Attachment failed".into(),
                                error.to_string(),
                                "Check owner/name, gh authentication and homelab.json.".into(),
                            ],
                            "Edit repository",
                        )?;
                    }
                }
            }
            _ => {}
        }
    }
}

fn configured_host<'a>(
    profile: &'a HostProfile,
    workspace: &'a config::Workspace,
) -> Option<&'a str> {
    let host = profile
        .configuration_host
        .as_deref()
        .unwrap_or(&profile.name);
    workspace.manifest.hosts.contains_key(host).then_some(host)
}

pub struct WizardTools {
    pub first_access: first_access::Tools,
    pub remote_setup: remote_setup::Tools,
}

fn native_tools() -> WizardTools {
    WizardTools {
        first_access: first_access::Tools {
            ssh: "/usr/bin/ssh".into(),
            ssh_keygen: "/usr/bin/ssh-keygen".into(),
            ssh_add: "/usr/bin/ssh-add".into(),
        },
        remote_setup: remote_setup::Tools {
            ssh: "/usr/bin/ssh".into(),
            scp: "/usr/bin/scp".into(),
        },
    }
}

pub fn launch(original: &HostProfile, inventory_path: &Path) -> io::Result<Outcome> {
    launch_with_tools(original, inventory_path, &native_tools())
}

pub(crate) fn launch_in_terminal(
    original: &HostProfile,
    inventory_path: &Path,
    terminal: &mut Terminal,
) -> io::Result<Outcome> {
    run_with_dependencies(
        original,
        inventory_path,
        &native_tools(),
        &EnrollmentDependencies::default(),
        terminal,
        false,
    )
}

pub(crate) fn authorize_in_terminal(
    original: &HostProfile,
    inventory_path: &Path,
    terminal: &mut Terminal,
) -> io::Result<Outcome> {
    run_with_dependencies(
        original,
        inventory_path,
        &native_tools(),
        &EnrollmentDependencies::default(),
        terminal,
        true,
    )
}

/// Explicit provider boundary for isolated enrollment tests. Completion always runs
/// the real verifier; only its Tailscale executable can be selected.
pub type PrepareCredentials =
    fn(
        &Path,
        &str,
        &config::Workspace,
        bool,
        &dyn Fn(&str),
    ) -> Result<crate::provisioning::Details, crate::enrollment_credentials::Error>;

pub struct EnrollmentDependencies {
    pub check_client_tools: fn() -> Result<(), crate::enrollment_credentials::Error>,
    pub prepare_credentials: PrepareCredentials,
    pub tailscale: Option<std::path::PathBuf>,
    pub prepare_administrator: fn(
        &Path,
        &str,
        &config::Workspace,
        &HostProfile,
        &Path,
    ) -> Result<(), crate::admin_credential::Error>,
}

impl Default for EnrollmentDependencies {
    fn default() -> Self {
        Self {
            check_client_tools: crate::enrollment_credentials::check_client_tools,
            prepare_credentials: |root, host, workspace, started, progress| {
                crate::enrollment_credentials::prepare(root, host, workspace, started, progress)
            },
            tailscale: None,
            prepare_administrator,
        }
    }
}

fn administrator_password(
    profile: &HostProfile,
    rejected: bool,
) -> Result<Option<crate::admin_credential::Secret>, crate::admin_credential::Error> {
    let mut password = crate::setup_auth::Password::new();
    loop {
        let mut body = ui::components::password_field(
            &format!(
                "Target: {} · {}",
                profile.resolved_configuration().unwrap_or(&profile.name),
                profile.user
            ),
            "Administrator password:",
            password.masked_length(),
            rejected,
        );
        body.push(("Verified on the target Mac, then saved in your configured 1Password vault for future setup.".into(),Role::Hint));
        render(
            "Mac administrator password",
            &body,
            0,
            &footer("Continue", &[Action::Clear, Action::Back, Action::Quit]),
        )
        .map_err(|_| crate::admin_credential::Error::Cancelled)?;
        match key().map_err(|_| crate::admin_credential::Error::Cancelled)? {
            KeyCode::Esc => return Ok(None),
            KeyCode::Enter if password.masked_length() > 0 => {
                return password.into_secret().map(Some);
            }
            KeyCode::Char('\u{15}') => password.clear(),
            code @ (KeyCode::Char(_) | KeyCode::Backspace) => {
                password.key(crossterm::event::KeyEvent::new(code, KeyModifiers::NONE))
            }
            _ => {}
        }
    }
}

fn prepare_administrator(
    root: &Path,
    host: &str,
    workspace: &config::Workspace,
    profile: &HostProfile,
    ssh: &Path,
) -> Result<(), crate::admin_credential::Error> {
    use crate::admin_credential::{Binding, Error, OnePassword};
    let vault = match &workspace.manifest.one_password {
        Some(config) => config.backup_vault.clone(),
        // Historical approved setups keep their verified independent backup
        // destination while migrating to the explicit Git configuration.
        None => crate::provisioning::legacy_backup_vault(root, &workspace.repository, host)
            .map_err(|_| Error::State)?
            .ok_or(Error::Configuration)?,
    };
    let executable = crate::tailscale_oauth::discover_op().map_err(|_| Error::Access)?;
    let binding = Binding {
        repository: workspace.repository.clone(),
        host: host.into(),
        user: profile.user.clone(),
        ssh_host_key: crate::setup_auth::verified_host_key(profile).ok_or(Error::Target)?,
    };
    render(
        "Authorizing setup",
        &[
            (host.into(), Role::Context),
            (
                "Checking the saved administrator credential in 1Password…".into(),
                Role::Body,
            ),
        ],
        0,
        &[Action::Quit],
    )
    .map_err(|_| Error::Cancelled)?;
    let password = crate::admin_credential::ensure(
        &OnePassword {
            executable: &executable,
        },
        &vault,
        &binding,
        &root.join("hosts").join(host).join("administrator.json"),
        |password| crate::setup_auth::validate_password(profile, ssh, password),
        |rejected| administrator_password(profile, rejected),
    )?;
    crate::setup_auth::cache(profile, &password).map_err(|_| Error::State)
}

/// Runs the same guided journey with explicit transport executables for isolated tests.
pub fn launch_with_tools(
    original: &HostProfile,
    inventory_path: &Path,
    tools: &WizardTools,
) -> io::Result<Outcome> {
    launch_with_dependencies(
        original,
        inventory_path,
        tools,
        &EnrollmentDependencies::default(),
    )
}

/// Run enrollment with explicit credentials and route dependencies, without
/// changing target identity checks, approved revisions or completion verification.
pub fn launch_with_dependencies(
    original: &HostProfile,
    inventory_path: &Path,
    tools: &WizardTools,
    dependencies: &EnrollmentDependencies,
) -> io::Result<Outcome> {
    let mut terminal = Terminal::enter()?;
    run_with_dependencies(
        original,
        inventory_path,
        tools,
        dependencies,
        &mut terminal,
        false,
    )
}

fn run_with_dependencies(
    original: &HostProfile,
    inventory_path: &Path,
    tools: &WizardTools,
    dependencies: &EnrollmentDependencies,
    terminal: &mut Terminal,
    authorize_only: bool,
) -> io::Result<Outcome> {
    let mut profile = original.clone();
    let saved = match saved_installation_workspace(&profile) {
        Ok(workspace) => workspace,
        Err(error) => return Ok(enrollment_failure(error)),
    };
    let workspace = match saved {
        Some(workspace) => workspace,
        None => match attached_workspace(&inventory_path.with_file_name("repository.json"))? {
            Some(workspace) => workspace,
            None => return Ok(cancelled(AccessChanges::default())),
        },
    };
    let configuration_host = match configured_host(&profile, &workspace) {
        Some(host) => host.to_owned(),
        None => {
            return Ok(enrollment_failure(
                "This saved connection is not bound to a host in this repository. Choose the host from GitHub in homelab; the saved connection is preserved.",
            ));
        }
    };
    if profile.user != workspace.manifest.hosts[&configuration_host].admin_user {
        return Ok(enrollment_failure(
            "The repository's administrator differs from this saved connection. Reopen homelab and review the Git-defined login before connecting.",
        ));
    }
    let changes = match connect(&mut profile, inventory_path, &tools.first_access, terminal)? {
        AccessOutcome::Finished(outcome) => return Ok(outcome),
        AccessOutcome::Continue(changes) => changes,
    };
    let _authentication =
        crate::setup_auth::Scope::begin_verified(&profile, &tools.remote_setup.ssh)?;
    let state = crate::enrollment_credentials::state_directory();
    if let Some(root) = &state {
        if root.exists() && !root.join("repository.json").exists() {
            let legacy_hosts = std::fs::read_dir(root.join("hosts"))
                .ok()
                .into_iter()
                .flatten()
                .filter_map(Result::ok)
                .filter_map(|entry| entry.file_name().into_string().ok())
                .filter(|host| crate::config::valid_host(host))
                .collect::<Vec<_>>();
            if !review(&[
                "Use these saved keys?".into(),
                format!("Repository: {}",workspace.repository),
                format!("Private state: {}",root.display()),
                format!("Existing hosts: {}",legacy_hosts.join(", ")),
                "Existing identities will be bound to this repository. Continue only if they belong to it.".into(),
            ],"Use these saved keys?")? {return Ok(cancelled(changes));}
        }
        if let Err(error) = crate::provisioning::bind_repository(root, &workspace.repository) {
            return Ok(Outcome {
                completed: false,
                lines: vec![error.to_string(), error.next_action().into()],
            });
        }
    }

    match state {
        Some(root) if authorize_only => Ok(authorize_existing(
            &profile,
            &workspace,
            &root,
            &configuration_host,
            tools,
            dependencies,
        )),
        Some(root) => enroll(
            &mut profile,
            &workspace,
            &root,
            &configuration_host,
            inventory_path,
            (tools, dependencies),
            terminal,
        ),
        None => Ok(enrollment_failure(
            "HOME is unavailable. No credentials were prepared.",
        )),
    }
}

fn authorize_existing(
    profile: &HostProfile,
    workspace: &config::Workspace,
    root: &Path,
    host_name: &str,
    tools: &WizardTools,
    dependencies: &EnrollmentDependencies,
) -> Outcome {
    let host = &workspace.manifest.hosts[host_name];
    match inspect::inspect(profile, &tools.first_access.ssh) {
        Ok(inspection)
            if inspection.is_ready()
                && inspection.user == host.admin_user
                && inspection.uid == u64::from(host.admin_uid) => {}
        Ok(_) => {
            return enrollment_failure(
                "This connection does not match the configured Mac administrator.",
            );
        }
        Err(error) => return enrollment_failure(error),
    }
    let _enrollment = match crate::provisioning::lock_enrollment(root) {
        Ok(lock) => lock,
        Err(error) => return enrollment_failure(error),
    };
    match (dependencies.prepare_administrator)(
        root,
        host_name,
        workspace,
        profile,
        &tools.remote_setup.ssh,
    ) {
        Ok(()) => Outcome {
            completed: true,
            lines: vec![format!(
                "Administrator credential for {host_name} verified and saved in 1Password."
            )],
        },
        Err(error) => enrollment_failure(error),
    }
}

pub(crate) fn saved_installation_workspace(
    profile: &HostProfile,
) -> Result<Option<config::Workspace>, Box<dyn std::error::Error>> {
    let Some(root) = crate::enrollment_credentials::state_directory() else {
        return Ok(None);
    };
    let host = profile.resolved_configuration().unwrap_or(&profile.name);
    if !config::valid_host(host) {
        return Ok(None);
    }
    let Some(saved) = crate::provisioning::approved_installation(&root, host)? else {
        return Ok(None);
    };
    Ok(Some(config::fetch_revision(
        &saved.repository,
        &saved.revision,
    )?))
}

fn preparation_workspace(
    saved: config::Workspace,
    bootstrap_started: bool,
    approved: bool,
) -> Result<config::Workspace, config::Error> {
    if bootstrap_started || approved {
        Ok(saved)
    } else {
        config::fetch(&saved.repository)
    }
}

fn enrollment_failure(error: impl std::fmt::Display) -> Outcome {
    let mut lines = vec!["Setup needs attention".into(), String::new()];
    lines.extend(error.to_string().lines().map(str::to_owned));
    if !crate::provider_diagnostics::write_failed()
        && let Some(path) = crate::provider_diagnostics::path()
    {
        lines.push(String::new());
        lines.push(format!("Log: {}", path.display()));
    }
    Outcome {
        completed: false,
        lines,
    }
}

fn remote_setup_failure(error: remote_setup::Error) -> Outcome {
    enrollment_failure(format!("{error}\n\n{}", error.next_action()))
}

fn check_enrollment_tools(
    root: &Path,
    host: &str,
    dependencies: &EnrollmentDependencies,
) -> Result<(), crate::enrollment_credentials::Error> {
    // An approved attempt may only need completion, without reopening providers.
    if crate::provisioning::approved_installation(root, host)?.is_none() {
        (dependencies.check_client_tools)()?;
    }
    Ok(())
}

fn queued_cancellation() -> io::Result<bool> {
    if crate::quit::requested() {
        return Ok(true);
    }
    while event::poll(std::time::Duration::from_millis(1))? {
        if let Event::Key(key) = event::read()?
            && crate::quit::handle(key) == KeyCode::Esc
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn saved_enrollment(url: &str) -> Outcome {
    Outcome {
        completed: false,
        lines: vec![
            "Setup saved. Reopen this host to continue.".into(),
            url.into(),
        ],
    }
}

fn save_and_release(
    url: &str,
    profile: &HostProfile,
    attempt: &crate::enrollment_reservation::Attempt,
    helper: &Path,
    tools: &remote_setup::Tools,
    bootstrap_started: bool,
) -> Outcome {
    let mut outcome = saved_enrollment(url);
    if !bootstrap_started
        && remote_setup::release_enrollment(profile, attempt, helper, tools).is_err()
    {
        outcome.lines.push("The target reservation could not be released. Resume this same saved attempt to reconcile it.".into());
    }
    outcome
}

fn enroll(
    profile: &mut HostProfile,
    workspace: &config::Workspace,
    root: &Path,
    host_name: &str,
    inventory_path: &Path,
    dependencies: (&WizardTools, &EnrollmentDependencies),
    _terminal: &mut Terminal,
) -> io::Result<Outcome> {
    let (tools, dependencies) = dependencies;
    if let Err(error) =
        crate::enrollment_credentials::check_setup_configuration(root, host_name, workspace)
    {
        return Ok(enrollment_failure(error));
    }
    if let Err(error) = check_enrollment_tools(root, host_name, dependencies) {
        return Ok(enrollment_failure(error));
    }
    let _enrollment = match crate::provisioning::lock_enrollment(root) {
        Ok(lock) => lock,
        Err(error) => return Ok(enrollment_failure(error)),
    };
    let host = &workspace.manifest.hosts[host_name];
    let public_key = if let Some(identity) = &profile.identity {
        identity.public_key.clone()
    } else {
        let Some(selected) = choose_key_source(&tools.first_access)? else {
            return Ok(enrollment_failure(
                "Setup cancelled before credential preparation.",
            ));
        };
        let key = selected.key.as_openssh().to_owned();
        if let Some(identity) = selected.identity {
            let mut candidate = profile.clone();
            candidate.identity = Some(identity.clone());
            if let Err(error) = first_access::check_key_access(
                &candidate,
                &tools.first_access,
                first_access::Trust::Strict,
            ) {
                return Ok(enrollment_failure(error));
            }
            match inventory::set_identity(inventory_path, profile, Some(identity)) {
                Ok(updated) => *profile = updated,
                Err(error) => return Ok(enrollment_failure(error)),
            }
            if crate::setup_auth::active()
                && let Err(error) =
                    crate::setup_auth::refresh_identity(profile, &tools.remote_setup.ssh)
            {
                return Ok(enrollment_failure(error));
            }
        }
        key
    };
    let inspection = match inspect::inspect(profile, &tools.first_access.ssh) {
        Ok(inspection)
            if inspection.is_ready()
                && inspection.user == host.admin_user
                && inspection.uid == u64::from(host.admin_uid) =>
        {
            inspection
        }
        Ok(_) => {
            return Ok(enrollment_failure(
                "This connection does not match the configured Mac administrator.",
            ));
        }
        Err(error) => return Ok(enrollment_failure(error)),
    };
    let prerequisites = match remote_setup::check_prerequisites(profile, &tools.remote_setup) {
        Ok(prerequisites) => prerequisites,
        Err(error) => {
            return Ok(remote_setup_failure(error));
        }
    };
    if dependencies.tailscale.is_none()
        && let Err(error) = crate::remote_completion::discover_tailscale()
    {
        return Ok(enrollment_failure(error));
    }
    let saved_approval = match crate::provisioning::approved_installation(root, host_name) {
        Ok(saved) => saved,
        Err(error) => return Ok(enrollment_failure(error)),
    };
    if saved_approval.as_ref().is_some_and(|saved| {
        saved.repository != workspace.repository || saved.revision != workspace.revision
    }) {
        return Ok(enrollment_failure(
            "The saved approval does not match this configuration. Preserve the attempt.",
        ));
    }
    if saved_approval.is_none()
        && !review(
            &[
                format!("Set up {host_name}?"),
                format!(
                    "{}@{} · {}",
                    profile.user,
                    profile.address,
                    inspection.storage_label()
                ),
                format!("Repo: {}", workspace.repository),
                String::new(),
                "Prepare · Back up keys and prepare this Mac.".into(),
                String::new(),
                "Install · Save configuration in Git and install it.".into(),
                String::new(),
                "Verify · Restart and check remote access and Git updates.".into(),
                String::new(),
                "FileVault may require a local unlock after restart.".into(),
            ],
            "Begin setup",
        )?
    {
        return Ok(enrollment_failure(
            "Setup cancelled before credential preparation.",
        ));
    }
    let mut checklist = Checklist::new(host_name);
    if let Err(error) = (dependencies.prepare_administrator)(
        root,
        host_name,
        workspace,
        profile,
        &tools.remote_setup.ssh,
    ) {
        return Ok(enrollment_failure(error));
    }
    checklist.begin(Step::Tools, "Checking required developer tools");
    checklist.draw(&[Action::Help])?;
    if checklist.stop_requested()? {
        return Ok(enrollment_failure(
            "Setup cancelled before prerequisite installation.",
        ));
    }
    if prerequisites == remote_setup::Prerequisites::DeveloperToolsMissing {
        let package = match checklist.background(|| package::prepare(workspace))? {
            Ok(package) => package,
            Err(error) => return Ok(enrollment_failure(error)),
        };
        if let Err(error) = crate::terminal_process::within("Preparing your Mac", host_name, || {
            remote_setup::install_developer_tools(
                profile,
                &package.directory.join("homelab-host"),
                &tools.remote_setup,
            )
        }) {
            return Ok(remote_setup_failure(error));
        }
    }
    checklist.done(Step::Tools);
    let cancelled = || {
        enrollment_failure(
            "Setup stopped at a safe checkpoint. Reopen this host to resume saved progress.",
        )
    };
    let attempt =
        match crate::provisioning::enrollment_attempt(root, &workspace.repository, host_name) {
            Ok(attempt) => attempt,
            Err(error) => return Ok(enrollment_failure(error)),
        };
    {
        let current_workspace = match checklist.background(|| {
            saved_installation_workspace(profile).map_err(|error| error.to_string())
        })? {
            Ok(Some(workspace)) => workspace,
            Ok(None) => match checklist.background(|| config::fetch(&workspace.repository))? {
                Ok(workspace) => workspace,
                Err(error) => return Ok(enrollment_failure(error)),
            },
            Err(error) => return Ok(enrollment_failure(error)),
        };
        let workspace = &current_workspace;
        if let Err(error) =
            crate::enrollment_credentials::check_setup_configuration(root, host_name, workspace)
        {
            return Ok(enrollment_failure(error));
        }
        let directory = root.join("hosts").join(host_name);

        let package = match checklist.background(|| package::prepare(workspace))? {
            Ok(package) => package,
            Err(error) => return Ok(enrollment_failure(error)),
        };
        let identity = match checklist.run(Step::Identity, |_| {
            remote_setup::prepare_git_identity(
                profile,
                &attempt,
                &package.directory.join("homelab-host"),
                &tools.remote_setup,
            )
        })? {
            Ok(identity) => identity,
            Err(error) => return Ok(remote_setup_failure(error)),
        };
        checklist.done(Step::Identity);
        if checklist.stop_requested()? {
            return Ok(cancelled());
        }
        if let Some(revision) = &identity.activated_revision {
            for step in [
                Step::Tools,
                Step::Identity,
                Step::Credentials,
                Step::Configuration,
                Step::Install,
            ] {
                checklist.done(step);
            }
            checklist.begin(Step::Verify, "Checking the existing activated setup");
            checklist.draw(&[Action::Help])?;
            let installed = match checklist
                .background(|| config::fetch_revision(&workspace.repository, revision))?
            {
                Ok(workspace) => workspace,
                Err(error) => return Ok(enrollment_failure(error)),
            };
            let outcome = crate::terminal_process::within_checklist(
                "Setting up your Mac",
                host_name,
                checklist.rows(),
                || {
                    finish_enrollment(
                        profile,
                        &installed,
                        &package.directory.join("homelab-host"),
                        &attempt,
                        tools,
                        dependencies,
                        &mut checklist,
                    )
                },
            );
            if outcome.completed {
                checklist.done(Step::Verify);
                checklist.done(Step::Updates);
            }
            checklist.message(if outcome.completed {
                "Setup complete."
            } else {
                "Verification needs attention; saved progress is retained."
            });
            checklist.draw(&[Action::Quit])?;
            return Ok(outcome);
        }
        let has_approval = match crate::provisioning::approved_installation(root, host_name) {
            Ok(approval) => approval.is_some(),
            Err(error) => return Ok(enrollment_failure(error)),
        };
        // A local approval already owns its revision even if SSH ended before
        // the target claimed it. Only unapproved preparations may follow main.
        let current_workspace = match preparation_workspace(
            current_workspace,
            identity.bootstrap_started,
            has_approval,
        ) {
            Ok(workspace) => workspace,
            Err(error) => return Ok(enrollment_failure(error)),
        };
        let workspace = &current_workspace;
        if !workspace.manifest.hosts.get(host_name).is_some_and(|host| {
            host.admin_user == inspection.user && u64::from(host.admin_uid) == inspection.uid
        }) {
            return Ok(enrollment_failure(
                "The current configuration no longer matches this Mac's administrator. Review the host configuration before continuing.",
            ));
        }
        let credentials = match checklist.run(Step::Credentials, |progress| {
            (dependencies.prepare_credentials)(
                root,
                host_name,
                workspace,
                identity.bootstrap_started,
                progress,
            )
        })? {
            Ok(prepared) => prepared,
            Err(error) => return Ok(enrollment_failure(error)),
        };
        if checklist.stop_requested()? {
            return Ok(cancelled());
        }
        checklist.done(Step::Credentials);
        let registry = crate::deploy_keys::GitHub::new(Path::new("gh"));
        if let Err(error) = checklist.run(Step::Configuration, |_| {
            crate::deploy_keys::register_saved(
                &registry,
                &crate::deploy_keys::Request {
                    repository: workspace.repository.clone(),
                    host: host_name.into(),
                    public_key: identity.public_key.clone(),
                },
                &directory.join("deploy-key.json"),
            )
        })? {
            return Ok(enrollment_failure(error));
        }
        if checklist.stop_requested()? {
            return Ok(cancelled());
        }
        checklist.begin(Step::Configuration, "Preparing encrypted Git changes");
        let api = crate::configuration_pr::GitHub {
            executable: "gh".into(),
        };
        let proposal_path = directory.join("proposal.json");
        let proposal = if proposal_path.exists() {
            crate::configuration_pr::Changes::load(&proposal_path, &workspace.repository, host_name)
        } else {
            match crate::enrollment_credentials::proposal(
                root,
                host_name,
                workspace,
                &public_key,
                &api,
            ) {
                Ok(proposal) => Ok(proposal),
                Err(error) => return Ok(enrollment_failure(error)),
            }
        };
        let proposal = match proposal {
            Ok(proposal) => proposal,
            Err(error) => return Ok(enrollment_failure(error)),
        };
        let selected = crate::ssh_identity::canonical_key(&public_key);
        if !proposal.manifest.hosts[host_name]
            .authorized_keys
            .iter()
            .any(|key| crate::ssh_identity::canonical_key(key) == selected)
        {
            return Ok(enrollment_failure(
                "This saved proposal authorizes a different SSH identity. Restore the original selection before continuing.",
            ));
        }
        if let Err(error) = proposal.save(&proposal_path) {
            return Ok(enrollment_failure(error));
        }
        if checklist.stop_requested()? {
            return Ok(cancelled());
        }
        let publication = match checklist.run(Step::Configuration, |_| {
            crate::configuration_pr::publish_configuration(
                &api,
                &proposal,
                &directory.join("publication.json"),
            )
        })? {
            Ok(publication) => publication,
            Err(error) => return Ok(enrollment_failure(error)),
        };
        let (approved, publication_url) = match publication {
            crate::configuration_pr::Publication::Published {
                workspace,
                html_url,
            } => (workspace, html_url),
            crate::configuration_pr::Publication::PullRequest(pull) => {
                checklist.begin(
                    Step::Configuration,
                    "Review and merge the setup PR. Setup continues automatically.",
                );
                if !checklist.pull_request(&workspace.repository, pull.number, &pull.html_url) {
                    return Ok(enrollment_failure(
                        "GitHub returned an unexpected pull request address. Preserve the saved proposal.",
                    ));
                }
                let mut next_poll = std::time::Instant::now();
                let approved = loop {
                    if next_poll <= std::time::Instant::now() {
                        match checklist.run(Step::Configuration, |_| {
                            crate::configuration_pr::approved_workspace(
                                &api,
                                &proposal,
                                pull.number,
                            )
                        })? {
                            Ok(Some(approved)) => break approved,
                            Ok(None) => checklist.message(
                                "Review and merge the setup PR. Setup continues automatically.",
                            ),
                            Err(error) => return Ok(enrollment_failure(error)),
                        }
                        next_poll = std::time::Instant::now() + std::time::Duration::from_secs(5);
                    }
                    checklist.draw(&[
                        Action::OpenPr,
                        Action::Help,
                        Action::Navigation,
                        Action::SaveAndExit,
                    ])?;
                    if checklist.cancelled {
                        return Ok(save_and_release(
                            &pull.html_url,
                            profile,
                            &attempt,
                            &package.directory.join("homelab-host"),
                            &tools.remote_setup,
                            identity.bootstrap_started,
                        ));
                    }
                    if event::poll(std::time::Duration::from_millis(250))? {
                        checklist.key(key()?);
                    }
                };
                checklist.clear_link();
                (approved, pull.html_url)
            }
        };
        if let Err(error) = crate::provisioning::save_approved_installation(
            root,
            &approved.repository,
            host_name,
            &approved.revision,
        ) {
            return Ok(enrollment_failure(error));
        }
        if checklist.stop_requested()? {
            return Ok(save_and_release(
                &publication_url,
                profile,
                &attempt,
                &package.directory.join("homelab-host"),
                &tools.remote_setup,
                identity.bootstrap_started,
            ));
        }
        match crate::enrollment_credentials::valid_for_installation(
            root,
            host_name,
            &workspace.repository,
        ) {
            Ok(true) => {}
            Ok(false) if identity.bootstrap_started => {
                return Ok(enrollment_failure(
                    crate::enrollment_credentials::Error::ExpiredStartedSetup,
                ));
            }
            Ok(false) => {
                return Ok(enrollment_failure(
                    crate::enrollment_credentials::Error::ExpiredApprovedSetup,
                ));
            }
            Err(error) => return Ok(enrollment_failure(error)),
        }
        let (approved, repair_from) = match checklist
            .background(|| crate::setup_repair::resolve(&api, root, approved, host_name))?
        {
            Ok(repaired) => repaired,
            Err(error) => return Ok(enrollment_failure(error)),
        };
        let repair_previous = match crate::provisioning::approved_installation(root, host_name) {
            Ok(Some(saved)) => saved
                .repair
                .and_then(|repair| repair.previous.map(|previous| previous.repaired_revision)),
            Ok(None) => None,
            Err(error) => return Ok(enrollment_failure(error)),
        };
        checklist.done(Step::Configuration);
        checklist.begin(Step::Install, "Preparing the exact approved installation");
        checklist.draw(&[Action::Help, Action::StopBeforeInstallation])?;
        let package = match checklist.background(|| package::prepare(&approved))? {
            Ok(package) => package,
            Err(error) => return Ok(enrollment_failure(error)),
        };
        if checklist.stop_requested()? {
            return Ok(cancelled());
        }
        checklist.message("Waiting for the exact checked host revision");
        match wait_for_deployment(&mut checklist, &api, &approved, host_name, &attempt.id)? {
            Ok(_) => {}
            Err(crate::deployment_lease::Error::Expired) => {
                let observed = match crate::terminal_process::within_checklist(
                    "Checking saved setup",
                    host_name,
                    checklist.rows(),
                    || {
                        remote_setup::prepare_git_identity(
                            profile,
                            &attempt,
                            &package.directory.join("homelab-host"),
                            &tools.remote_setup,
                        )
                    },
                ) {
                    Ok(observed)
                        if observed.public_key == identity.public_key
                            && observed.path == identity.path =>
                    {
                        observed
                    }
                    Ok(_) => {
                        return Ok(enrollment_failure(crate::deployment_lease::Error::Invalid));
                    }
                    Err(error) => return Ok(remote_setup_failure(error)),
                };
                if let Some(revision) = &observed.activated_revision {
                    if revision != &approved.revision {
                        return Ok(enrollment_failure(
                            crate::deployment_lease::Error::Superseded,
                        ));
                    }
                    return Ok(crate::terminal_process::within_checklist(
                        "Setting up your Mac",
                        host_name,
                        checklist.rows(),
                        || {
                            finish_enrollment(
                                profile,
                                &approved,
                                &package.directory.join("homelab-host"),
                                &attempt,
                                tools,
                                dependencies,
                                &mut checklist,
                            )
                        },
                    ));
                }
                if let Err(error) = checklist.background(|| {
                    crate::deployment_lease::recover_resume(
                        &api,
                        &approved,
                        host_name,
                        &attempt.id,
                        &observed,
                    )
                })? {
                    return Ok(enrollment_failure(error));
                }
            }
            Err(error) => return Ok(enrollment_failure(error)),
        }
        if checklist.stop_requested()? {
            let _ = checklist.background(|| {
                crate::deployment_lease::cancel_prepared(&api, &approved, host_name, &attempt.id)
            })?;
            return Ok(cancelled());
        }
        if let Err(error) = checklist.background(|| {
            crate::deployment_lease::activate(&api, &approved, host_name, &attempt.id)
        })? {
            return Ok(enrollment_failure(error));
        }
        if checklist.stop_requested()? {
            return Ok(cancelled());
        }
        let prepared = match crate::terminal_process::within_checklist(
            "Preparing saved setup",
            host_name,
            checklist.rows(),
            || {
                remote_setup::prepare(
                    Request {
                        attempt: attempt.id.clone(),
                        repository: approved.repository.clone(),
                        profile: profile.clone(),
                        configuration_host: host_name.into(),
                        revision: approved.revision.clone(),
                        artifact_directory: package.directory.clone(),
                        age_key: credentials.host_key_path,
                        deploy_key: identity.path,
                        resume: true,
                        repair_from,
                        repair_previous,
                    },
                    &tools.remote_setup,
                )
            },
        ) {
            Ok(prepared) => prepared,
            Err(error) => return Ok(remote_setup_failure(error)),
        };
        if queued_cancellation()? {
            return Ok(save_and_release(
                &publication_url,
                profile,
                &attempt,
                &package.directory.join("homelab-host"),
                &tools.remote_setup,
                identity.bootstrap_started,
            ));
        }
        if let Err(error) = checklist.background(|| {
            crate::deployment_lease::renew(&api, &approved, host_name, &attempt.id)
        })? {
            return Ok(enrollment_failure(error));
        }
        match crate::terminal_process::within_checklist(
            "Setting up your Mac",
            host_name,
            checklist.rows(),
            || remote_setup::apply(prepared, &tools.remote_setup),
        ) {
            Ok(_) => {
                checklist.done(Step::Install);
                checklist.begin(Step::Verify, "Checking reboot and remote access");
                let outcome = crate::terminal_process::within_checklist(
                    "Setting up your Mac",
                    host_name,
                    checklist.rows(),
                    || {
                        finish_enrollment(
                            profile,
                            &approved,
                            &package.directory.join("homelab-host"),
                            &attempt,
                            tools,
                            dependencies,
                            &mut checklist,
                        )
                    },
                );
                if outcome.completed {
                    checklist.done(Step::Verify);
                    checklist.done(Step::Updates);
                }
                checklist.message(if outcome.completed {
                    "Setup complete."
                } else {
                    "Verification needs attention; saved progress is retained."
                });
                checklist.draw(&[Action::Quit])?;
                Ok(outcome)
            }
            Err(error) => Ok(remote_setup_failure(error)),
        }
    }
}

fn wait_for_deployment(
    checklist: &mut Checklist,
    api: &crate::configuration_pr::GitHub,
    workspace: &config::Workspace,
    host: &str,
    attempt: &str,
) -> io::Result<Result<bool, crate::deployment_lease::Error>> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1200);
    loop {
        if checklist.stop_requested()? {
            return Ok(Err(crate::deployment_lease::Error::Cancelled));
        }
        let result = checklist
            .background(|| crate::deployment_lease::acquire(api, workspace, host, attempt))?;
        if checklist.stop_requested()? {
            let _ = checklist.background(|| {
                crate::deployment_lease::cancel_prepared(api, workspace, host, attempt)
            })?;
            return Ok(Err(crate::deployment_lease::Error::Cancelled));
        }
        if !matches!(result, Err(crate::deployment_lease::Error::NotPromoted))
            || std::time::Instant::now() >= deadline
        {
            return Ok(result);
        }
        for _ in 0..50 {
            if checklist.stop_requested()? {
                return Ok(Err(crate::deployment_lease::Error::Cancelled));
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
}

fn finish_enrollment(
    profile: &HostProfile,
    workspace: &config::Workspace,
    helper: &Path,
    reservation: &crate::enrollment_reservation::Attempt,
    tools: &WizardTools,
    dependencies: &EnrollmentDependencies,
    checklist: &mut Checklist,
) -> Outcome {
    if checklist.stop_requested().unwrap_or(true) {
        return enrollment_failure(crate::deployment_lease::Error::Cancelled);
    }
    if reservation.repository != workspace.repository {
        return enrollment_failure(crate::deployment_lease::Error::Invalid);
    }
    let host = reservation.host.as_str();
    let attempt = reservation.id.as_str();
    let api = crate::configuration_pr::GitHub {
        executable: "gh".into(),
    };
    match crate::deployment_lease::acquire(&api, workspace, host, attempt)
        .and_then(|_| crate::deployment_lease::activate(&api, workspace, host, attempt))
    {
        Ok(_) => {}
        Err(crate::deployment_lease::Error::Expired) => {
            let proof = match remote_setup::prepare_git_identity(
                profile,
                reservation,
                helper,
                &tools.remote_setup,
            ) {
                Ok(proof) => proof,
                Err(error) => return remote_setup_failure(error),
            };
            if let Err(error) = crate::deployment_lease::recover_verification(
                &api, workspace, host, attempt, &proof,
            ) {
                return enrollment_failure(error);
            }
        }
        Err(error) => return enrollment_failure(error),
    }
    // Recovery first fences the exact inspected source; only its verified report
    // can release it. Verification never reinstalls an already activated source.

    if checklist.stop_requested().unwrap_or(true) {
        return enrollment_failure(crate::deployment_lease::Error::Cancelled);
    }

    let Some(tailscale) = workspace.manifest.tailscale.as_ref() else {
        return enrollment_failure("The approved configuration is missing its Tailscale tag.");
    };
    let tailscale_executable = match dependencies
        .tailscale
        .clone()
        .map(Ok)
        .unwrap_or_else(crate::remote_completion::discover_tailscale)
    {
        Ok(path) => path,
        Err(error) => return enrollment_failure(error),
    };
    match crate::remote_completion::finish_with_tools(
        profile,
        &tools.remote_setup.ssh,
        &tailscale_executable,
        crate::remote_completion::Installation {
            branch: workspace.manifest.deployment_branch(),
            repository: &workspace.repository,
            host,
            revision: &workspace.revision,
            tag: &tailscale.tag,
        },
        |phase| {
            if phase == crate::remote_completion::Progress::EnablingUpdates {
                checklist.done(Step::Verify);
                checklist.begin(Step::Updates, phase.message());
                crate::terminal_process::progress_steps(checklist.rows());
                crate::terminal_process::phase("Setting up your Mac", phase.message());
            } else {
                crate::terminal_process::phase("Setting up your Mac", phase.message());
            }
        },
    ) {
        Ok(report) => {
            if let Err(error) =
                crate::deployment_lease::release_verified(&api, workspace, host, attempt, &report)
            {
                return enrollment_failure(error);
            }
            Outcome {
                completed: true,
                lines: completed_lines(
                    host,
                    report
                        .reconciled_revision
                        .as_deref()
                        .unwrap_or(&workspace.revision),
                    &report.tailscale.dns_name,
                ),
            }
        }
        Err(error) => enrollment_failure(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn unclaimed_renewals_refresh_main_but_claimed_installations_keep_their_revision() {
        const CHILD: &str = "HOMELAB_RENEWAL_FIXTURE";
        if let Some(root) = std::env::var_os(CHILD) {
            let root = std::path::PathBuf::from(root);
            for revision in ["b".repeat(40), "c".repeat(40)] {
                std::fs::write(root.join("main"), &revision).unwrap();
                let fresh = preparation_workspace(workspace(), false, false).unwrap();
                assert_eq!(fresh.revision, revision);
            }
            std::fs::remove_file(root.join("main")).unwrap();
            let claimed = preparation_workspace(workspace(), true, false).unwrap();
            assert_eq!(claimed.revision, "a".repeat(40));
            let approved_before_claim = preparation_workspace(workspace(), false, true).unwrap();
            assert_eq!(approved_before_claim.revision, "a".repeat(40));
            return;
        }
        let temporary = tempfile::tempdir().unwrap();
        let output = std::process::Command::new("rustc")
            .args(["--edition=2024", "-o"])
            .arg(temporary.path().join("gh"))
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/renewal_manifest.rs"))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "setup_wizard::tests::unclaimed_renewals_refresh_main_but_claimed_installations_keep_their_revision", "--test-threads=1"])
            .env(CHILD, temporary.path())
            .env("HOME", temporary.path())
            .env("PATH", temporary.path())
            .output().unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn client_preflight_fails_without_creating_state_and_skips_approved_resume() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("provisioning");
        let dependencies = EnrollmentDependencies {
            check_client_tools: || Err(crate::provisioning::Error::ToolsUnavailable.into()),
            ..EnrollmentDependencies::default()
        };
        assert!(matches!(
            check_enrollment_tools(&root, "test-host", &dependencies),
            Err(crate::enrollment_credentials::Error::Preparation(
                crate::provisioning::Error::ToolsUnavailable
            ))
        ));
        assert!(!root.exists());
        crate::provisioning::save_approved_installation(
            &root,
            "example/config",
            "test-host",
            &"a".repeat(40),
        )
        .unwrap();
        check_enrollment_tools(&root, "test-host", &dependencies).unwrap();
        // A different, new host still needs the client tools.
        assert!(check_enrollment_tools(&root, "other-host", &dependencies).is_err());
    }

    #[test]
    fn saved_installation_does_not_consult_current_main() {
        const CHILD: &str = "HOMELAB_TEST_APPROVED_MANIFEST";
        if std::env::var_os(CHILD).is_some() {
            let profile = HostProfile {
                name: "saved-connection".into(),
                address: "example-host".into(),
                user: "original-admin".into(),
                identity: None,
                configuration_host: Some("removed-from-main".into()),
            };
            let workspace = saved_installation_workspace(&profile).unwrap().unwrap();
            assert_eq!(workspace.revision, "a".repeat(40));
            assert_eq!(
                workspace.manifest.hosts["removed-from-main"].admin_user,
                "original-admin"
            );
            return;
        }
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary
            .path()
            .join(".homelab/profiles/default/provisioning");
        crate::provisioning::save_approved_installation(
            &root,
            "example/config",
            "removed-from-main",
            &"a".repeat(40),
        )
        .unwrap();
        let output = std::process::Command::new("rustc")
            .args(["--edition=2024", "-o"])
            .arg(temporary.path().join("gh"))
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/approved_manifest.rs"))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "setup_wizard::tests::saved_installation_does_not_consult_current_main",
                "--test-threads=1",
            ])
            .env(CHILD, "1")
            .env("HOME", temporary.path())
            .env("PATH", temporary.path())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    fn workspace() -> config::Workspace {
        config::Workspace {
            repository: "example/config".into(),
            revision: "a".repeat(40),
            manifest: config::Manifest {
                schema: 1,
                schema_url: None,
                deployment: None,
                one_password: None,
                tailscale: None,
                hosts: ["build-mac", "service-mac"]
                    .into_iter()
                    .map(|name| {
                        (
                            name.into(),
                            config::Host {
                                admin_user: "operator".into(),
                                admin_uid: 501,
                                authorized_keys: vec![],
                                services: vec![],
                            },
                        )
                    })
                    .collect(),
            },
        }
    }
    fn profile() -> HostProfile {
        HostProfile {
            name: "lan-mini".into(),
            address: "mini".into(),
            user: "operator".into(),
            identity: None,
            configuration_host: None,
        }
    }

    #[test]
    fn stopped_setup_cannot_start_finish_enrollment() {
        let mut checklist = Checklist::new("build-mac");
        checklist.cancelled = true;
        // Historical fixtures have no provider or remote activation path. This
        // catches a missing cancellation checkpoint without network access.
        let outcome = finish_enrollment(
            &profile(),
            &workspace(),
            Path::new("/unused/helper"),
            &crate::enrollment_reservation::Attempt {
                id: "e".repeat(64),
                repository: "example/config".into(),
                host: "build-mac".into(),
            },
            &native_tools(),
            &EnrollmentDependencies::default(),
            &mut checklist,
        );
        assert!(!outcome.completed);
        assert!(
            outcome
                .lines
                .join("\n")
                .contains("Setup stopped; saved progress is retained.")
        );
    }

    #[test]
    fn authorization_only_preserves_approved_setup_and_never_prepares_or_installs() {
        let temporary = tempfile::tempdir().unwrap();
        let ssh = temporary.path().join("ssh-fixture");
        assert!(
            std::process::Command::new("rustc")
                .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ssh.rs"))
                .arg("-o")
                .arg(&ssh)
                .status()
                .unwrap()
                .success()
        );
        let root = temporary.path().join("provisioning");
        crate::provisioning::save_approved_installation(
            &root,
            "example/config",
            "build-mac",
            &"a".repeat(40),
        )
        .unwrap();
        let approval = root.join("installations/build-mac.json");
        let before = std::fs::read(&approval).unwrap();
        std::fs::write(
            temporary.path().join("response"),
            "27.2\narm64\noperator\n501\n104857600\n500000000\n",
        )
        .unwrap();
        let mut profile = profile();
        profile.name = "build-mac".into();
        profile.address = "example-host".into();
        let tools = WizardTools {
            first_access: first_access::Tools {
                ssh: ssh.clone(),
                ssh_add: "/not-called".into(),
                ssh_keygen: "/not-called".into(),
            },
            remote_setup: remote_setup::Tools {
                ssh,
                scp: "/not-called".into(),
            },
        };
        let dependencies = EnrollmentDependencies {
            check_client_tools: || panic!("authorization must not check installation tools"),
            prepare_credentials: |_, _, _, _, _| {
                panic!("authorization must not prepare enrollment")
            },
            tailscale: Some("/not-called".into()),
            prepare_administrator: |root, host, workspace, profile, _| {
                assert_eq!(host, "build-mac");
                assert_eq!(workspace.repository, "example/config");
                assert_eq!(profile.user, "operator");
                std::fs::write(root.join("authorized"), b"non-secret fixture receipt").unwrap();
                Ok(())
            },
        };
        let outcome = authorize_existing(
            &profile,
            &workspace(),
            &root,
            "build-mac",
            &tools,
            &dependencies,
        );
        assert!(outcome.completed);
        assert!(root.join("authorized").exists());
        assert_eq!(std::fs::read(&approval).unwrap(), before);
        assert!(!root.join("hosts").exists());
        assert!(!root.join("attempts").exists());
        std::fs::remove_file(root.join("authorized")).unwrap();
        std::fs::write(
            temporary.path().join("response"),
            "27.2\narm64\noperator\n502\n104857600\n500000000\n",
        )
        .unwrap();
        let outcome = authorize_existing(
            &profile,
            &workspace(),
            &root,
            "build-mac",
            &tools,
            &dependencies,
        );
        assert!(!outcome.completed);
        assert!(!root.join("authorized").exists());
        assert_eq!(std::fs::read(&approval).unwrap(), before);
    }

    #[test]
    fn exact_names_and_saved_aliases_resolve_without_another_host_question() {
        let workspace = workspace();
        let mut profile = profile();
        assert_eq!(configured_host(&profile, &workspace), None);
        profile.configuration_host = Some("service-mac".into());
        assert_eq!(configured_host(&profile, &workspace), Some("service-mac"));
        profile.configuration_host = None;
        profile.name = "build-mac".into();
        assert_eq!(configured_host(&profile, &workspace), Some("build-mac"));
    }
    #[test]
    fn attach_terminal_child() {
        let Some(path) = std::env::var_os("HOMELAB_ATTACH_TEST_PATH") else {
            return;
        };
        let mut terminal = Terminal::enter().unwrap();
        let workspace = attached_workspace(Path::new(&path)).unwrap().unwrap();
        assert_eq!(workspace.repository, "example/config");
        assert!(workspace.manifest.hosts.contains_key("test-host"));
        terminal.suspend().unwrap();
        terminal.suspend().unwrap();
        println!("NATIVE_PROMPT_READY");
        let mut answer = String::new();
        io::stdin().read_line(&mut answer).unwrap();
        assert_eq!(answer.trim(), "continue");
        terminal.resume().unwrap();
        terminal.resume().unwrap();
        let modes = rustix::termios::tcgetattr(io::stdin()).unwrap().local_modes;
        assert!(!modes.contains(rustix::termios::LocalModes::ICANON));
        draw(&["Back in setup".into()], 0, &[Action::Quit]).unwrap();
        drop(terminal);
        println!("ATTACH_COMPLETE");
    }

    #[test]
    fn terminal_attach_persists_repository_without_a_second_confirmation() {
        use rustix::fs::{Mode, OFlags, fcntl_setfl, open};
        use rustix::io::{FdFlags, fcntl_setfd};
        use rustix::pty::{OpenptFlags, grantpt, openpt, ptsname, unlockpt};
        use rustix::termios::{Winsize, tcgetattr, tcsetwinsize};
        use std::fs::{self, File};
        use std::io::Read;
        use std::os::unix::fs::PermissionsExt;
        use std::process::{Command, Stdio};
        use std::time::{Duration, Instant};
        let temporary = tempfile::tempdir().unwrap();
        let bin = temporary.path().join("bin");
        fs::create_dir(&bin).unwrap();
        let gh = bin.join("gh");
        fs::write(&gh, concat!("#!/bin/sh\ncase \"$4\" in\n",
            "repos/example/config/commits/main) printf '%s\\n' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ;;\n",
            "repos/example/config/contents/projects/homelab/homelab.json?ref=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) cat <<'JSON'\n",
            "{\"schema\":1,\"hosts\":{\"test-host\":{\"adminUser\":\"operator\",\"adminUID\":501,\"authorizedKeys\":[],\"activationReady\":false,\"services\":[]}},\"tailscale\":null}\nJSON\n;;\n*) exit 9 ;;\nesac\n")).unwrap();
        fs::set_permissions(&gh, fs::Permissions::from_mode(0o700)).unwrap();
        let private = temporary.path().join("private");
        fs::create_dir(&private).unwrap();
        fs::set_permissions(&private, fs::Permissions::from_mode(0o700)).unwrap();
        let path = private.join("repository.json");
        let master = openpt(OpenptFlags::RDWR | OpenptFlags::NOCTTY).unwrap();
        fcntl_setfd(&master, FdFlags::CLOEXEC).unwrap();
        grantpt(&master).unwrap();
        unlockpt(&master).unwrap();
        let slave = File::from(
            open(
                ptsname(&master, Vec::new()).unwrap(),
                OFlags::RDWR | OFlags::NOCTTY | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .unwrap(),
        );
        tcsetwinsize(
            &slave,
            Winsize {
                ws_row: 12,
                ws_col: 40,
                ws_xpixel: 0,
                ws_ypixel: 0,
            },
        )
        .unwrap();
        let original = tcgetattr(&slave).unwrap().local_modes;
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "setup_wizard::tests::attach_terminal_child",
                "--nocapture",
            ])
            .env("HOMELAB_ATTACH_TEST_PATH", &path)
            .env("HOME", temporary.path())
            .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
            .env("TERM", "xterm-256color")
            .stdin(Stdio::from(slave.try_clone().unwrap()))
            .stdout(Stdio::from(slave.try_clone().unwrap()))
            .stderr(Stdio::from(slave.try_clone().unwrap()))
            .spawn()
            .unwrap();
        fcntl_setfl(&master, OFlags::NONBLOCK).unwrap();
        let mut master = File::from(master);
        let mut output = String::new();
        let mut parser = vt100::Parser::new(12, 40, 0);
        let mut wait_for = |needle: &str, master: &mut File| {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                let mut bytes = [0; 4096];
                match master.read(&mut bytes) {
                    Ok(count) => {
                        output.push_str(&String::from_utf8_lossy(&bytes[..count]));
                        parser.process(&bytes[..count]);
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
                    Err(error) => panic!("terminal failed: {error}"),
                }
                if output.contains(needle) || parser.screen().contents().contains(needle) {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "missing terminal prompt: {needle}; {output}"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
        };
        wait_for("Which repo do you want to use?", &mut master);
        assert!(!path.exists());
        master.write_all(b"example/config\r").unwrap();
        wait_for("NATIVE_PROMPT_READY", &mut master);
        let native_modes = tcgetattr(&slave).unwrap().local_modes;
        assert!(native_modes.contains(rustix::termios::LocalModes::ICANON));
        assert!(native_modes.contains(rustix::termios::LocalModes::ECHO));
        master.write_all(b"continue\n").unwrap();
        wait_for("ATTACH_COMPLETE", &mut master);
        assert_eq!(output.matches("\x1b[?1049h").count(), 2);
        assert_eq!(output.matches("\x1b[?1049l").count(), 2);
        assert!(child.wait().unwrap().success());
        // PENDIN reflects kernel input reprocessing, not a changed terminal mode.
        assert_eq!(
            tcgetattr(&slave).unwrap().local_modes & !rustix::termios::LocalModes::PENDIN,
            original & !rustix::termios::LocalModes::PENDIN
        );
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["repository"], "example/config");
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn enter_returns_from_information_without_approving_unread_confirmation() {
        assert_eq!(review_enter_result("", 0, 10), Some(false));
        assert_eq!(review_enter_result("Connect", 0, 10), None);
        assert_eq!(review_enter_result("Connect", 10, 10), Some(true));
        let outcome = enrollment_failure("Could not connect.\n\nTry again.");
        assert_eq!(
            outcome.lines,
            [
                "Setup needs attention",
                "",
                "Could not connect.",
                "",
                "Try again."
            ]
        );
    }

    #[test]
    fn single_agent_key_is_selected_without_a_terminal_or_source_question() {
        struct Agent(std::process::Child);
        impl Drop for Agent {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let root = tempfile::tempdir().unwrap();
        let socket = root.path().join("agent.sock");
        let mut command = std::process::Command::new("/usr/bin/ssh-agent");
        command
            .arg("-D")
            .arg("-a")
            .arg(&socket)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let _agent = Agent(command.spawn().unwrap());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !socket.exists() {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let key = root.path().join("fixture-key");
        assert!(
            std::process::Command::new("/usr/bin/ssh-keygen")
                .args(["-q", "-t", "ed25519", "-N", "", "-f"])
                .arg(&key)
                .status()
                .unwrap()
                .success()
        );
        assert!(
            std::process::Command::new("/usr/bin/ssh-add")
                .arg(&key)
                .env("SSH_AUTH_SOCK", &socket)
                .output()
                .unwrap()
                .status
                .success()
        );
        let tools = first_access::Tools {
            ssh: "/usr/bin/ssh".into(),
            ssh_keygen: "/usr/bin/ssh-keygen".into(),
            ssh_add: "/usr/bin/ssh-add".into(),
        };
        let keys = first_access::list_agent_keys(&socket, &tools).unwrap();
        assert_eq!(keys.len(), 1);
        let selected = select_agent_key(keys).unwrap().unwrap();
        assert_eq!(selected.identity.unwrap().agent_socket, socket);
    }

    #[test]
    fn failures_offer_the_relevant_primary_action_without_guessing() {
        use first_access::Error;
        assert_eq!(
            failure_screen(&Error::AuthenticationDenied).2[0],
            AccessAction::InstallKey
        );
        assert_eq!(
            failure_screen(&Error::HostUnknown).2[0],
            AccessAction::Trust
        );
        for error in [
            Error::Connection,
            Error::HostChanged,
            Error::ConnectionRefused,
            Error::ConnectionTimeout,
            Error::NameResolution,
            Error::AgentRefused,
        ] {
            assert_eq!(failure_screen(&error).2[0], AccessAction::Check);
        }
        assert_eq!(failure_screen(&Error::HostChanged).2, [AccessAction::Check]);
    }

    #[test]
    fn only_rejected_key_authentication_can_start_password_installation() {
        use first_access::Error;
        assert_eq!(installation_required(Ok(())), Ok(false));
        assert_eq!(
            installation_required(Err(Error::AuthenticationDenied)),
            Ok(true)
        );
        for error in [
            Error::HostUnknown,
            Error::HostChanged,
            Error::AgentRefused,
            Error::Connection,
            Error::ConnectionRefused,
            Error::ConnectionTimeout,
            Error::NameResolution,
            Error::UnknownOutcome,
        ] {
            let expected = error.code();
            assert_eq!(
                installation_required(Err(error)).unwrap_err().code(),
                expected
            );
        }
    }

    #[test]
    fn agent_key_picker_keeps_every_selected_name_and_fingerprint_visible() {
        let keys: Vec<_> = (0..32)
            .map(|index| {
                (
                    format!("Key {index}: {}", "a long descriptive comment ".repeat(8)),
                    format!("SHA256:{}{index:02}", "a".repeat(41)),
                )
            })
            .collect();
        let labels: Vec<_> = keys
            .iter()
            .map(|(name, fingerprint)| (name.as_str(), fingerprint.as_str()))
            .collect();
        for (selected, (_, fingerprint)) in keys.iter().enumerate() {
            for (width, room) in [(36, 5), (76, 17)] {
                let lines = agent_key_lines(&labels, selected, width, room);
                let visible = wrap(&lines[1..], width);
                assert!(visible.len() <= room);
                assert!(
                    visible
                        .iter()
                        .any(|line| line.starts_with(&format!("> Key {selected}:")))
                );
                assert!(visible.concat().contains(fingerprint));
                assert!(visible.iter().all(|line| line.chars().count() <= width));
            }
        }
        let help = footer("Review this key", &[Action::Navigation, Action::Back]);
        assert!(help.iter().all(|action| !action.label().contains('\n')));
        assert_eq!(
            crate::ui::help_lines(
                &help
                    .iter()
                    .map(Action::label)
                    .collect::<Vec<_>>()
                    .join(" · "),
                36
            )
            .len(),
            2
        );
        assert!(help.iter().all(|action| !action.label().contains("SHA256")));
    }

    #[test]
    fn cancellation_does_not_claim_to_undo_first_access() {
        let untouched = cancelled(AccessChanges::default());
        assert_eq!(untouched.lines.len(), 1);
        let changed = cancelled(AccessChanges {
            trust_attempted: true,
            key_attempted: true,
            identity_saved: true,
        });
        assert!(!changed.completed);
        assert!(
            changed
                .lines
                .iter()
                .any(|line| line.contains("host key may have been saved"))
        );
        assert!(
            changed
                .lines
                .iter()
                .any(|line| line.contains("public key may have been installed"))
        );
        assert!(
            !changed
                .lines
                .iter()
                .any(|line| line.contains("no target settings changed"))
        );
    }
}
