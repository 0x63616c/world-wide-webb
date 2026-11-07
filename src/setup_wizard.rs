//! Interactive first setup; credentials stay in files and sudo owns its terminal.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crossterm::cursor::MoveTo;
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use crossterm::queue;
use crossterm::terminal::{self, Clear, ClearType};

use crate::inventory::{self, AgentIdentity, HostProfile};
use crate::remote_setup::{self, Request};
use crate::tui::{Terminal, footer, wrap};
use crate::ui::{self, Role};
use crate::{config, first_access, inspect, package};

fn render(title: &str, body: &[(String, Role)], offset: usize, footer: &str) -> io::Result<usize> {
    let (width, height) = terminal::size()?;
    let mut output = Vec::new();
    queue!(output, MoveTo(0, 0), Clear(ClearType::All))?;
    if width < 40 || height < 12 {
        write!(output, "Enlarge terminal to 40 columns / 12 rows.")?;
        flush_frame(&output)?;
        return Ok(0);
    }
    let width = ui::content_width(width);
    let footer = ui::help_lines(footer, width);
    let wrapped: Vec<_> = body
        .iter()
        .flat_map(|(text, role)| {
            wrap(std::slice::from_ref(text), width)
                .into_iter()
                .map(|line| (line, *role))
        })
        .collect();
    let room = usize::from(height).saturating_sub(footer.len() + 5);
    let last = wrapped.len().saturating_sub(room);
    queue!(output, MoveTo(2, 1))?;
    ui::paint(
        &mut output,
        &title.chars().take(width).collect::<String>(),
        Role::Heading,
    )?;
    let visible = wrapped.iter().skip(offset.min(last)).take(room);
    let mut row = 3;
    for (line, role) in visible {
        queue!(output, MoveTo(2, row))?;
        if matches!(role, Role::Body) {
            ui::paint_fact(&mut output, line)?;
        } else {
            ui::paint(&mut output, line, *role)?;
        }
        row += 1;
    }
    // Keep the next action next to the content, even in a tall terminal.
    for (index, line) in footer.iter().enumerate() {
        queue!(output, MoveTo(2, row + 1 + index as u16))?;
        ui::paint(
            &mut output,
            line,
            if index == 0 { Role::Action } else { Role::Help },
        )?;
    }
    flush_frame(&output)?;
    Ok(last)
}

fn flush_frame(frame: &[u8]) -> io::Result<()> {
    // Emit the clear and complete replacement together, not as separate writes.
    let mut output = io::stdout().lock();
    output.write_all(frame)?;
    output.flush()
}

pub(crate) fn draw(lines: &[String], offset: usize, footer: &str) -> io::Result<usize> {
    let Some((title, body)) = lines.split_first() else {
        return Ok(0);
    };
    let body = body
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, line)| {
            let role = if line.starts_with("> ") {
                Role::Selected
            } else if line.starts_with("! ") {
                Role::Warning
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
    loop {
        let event = event::read()?;
        if matches!(event, Event::Resize(..)) {
            return Ok(KeyCode::Null);
        }
        if let Event::Key(key) = event {
            if key.kind == event::KeyEventKind::Release {
                continue;
            }
            if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
                return Ok(KeyCode::Esc);
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
            Self::Trust => "Review host trust",
            Self::InstallKey => "Install public key",
        }
    }
}

fn failure_screen(error: &first_access::Error) -> (&'static str, &'static str, Vec<AccessAction>) {
    use AccessAction::{Check, InstallKey, Trust};
    use first_access::Error;
    match error {
        Error::HostUnknown => (
            "New Mac: trust not saved",
            "Review the identity warning before trusting this address.",
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
            "Enable Remote Login for this account on the target Mac, then check its address.",
            vec![Check],
        ),
        Error::ConnectionTimeout => (
            "The Mac did not respond",
            "Check the target is awake and on the same reachable network.",
            vec![Check],
        ),
        Error::NameResolution => (
            "Address not found",
            "Check the address saved in this connection profile.",
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
            "Check Remote Login and the address. The cause is unknown.",
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
                    Role::Body
                },
            )
        }));
        let navigation = if actions.len() > 1 {
            "↑/↓ select · Esc back"
        } else {
            "Esc back"
        };
        render(&lines[0], &content, 0, &footer("Select", navigation))?;
        match key()? {
            KeyCode::Esc => return Ok(None),
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
                    'k' => "Install public key",
                    't' => "Review host trust",
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
    let mut offset = 0;
    loop {
        let last = draw(lines, offset, &footer(primary, "Esc back"))?;
        if last > 0 {
            let action = if offset < last {
                "Read more before approval"
            } else {
                primary
            };
            draw(
                lines,
                offset,
                &footer(
                    action,
                    &format!("↑/↓ read {}/{} · Esc back", offset + 1, last + 1),
                ),
            )?;
        }
        match key()? {
            KeyCode::Esc => return Ok(false),
            KeyCode::Down | KeyCode::PageDown => offset = (offset + 1).min(last),
            KeyCode::Up | KeyCode::PageUp => offset = offset.saturating_sub(1),
            KeyCode::Enter if offset >= last && usable_size()? => return Ok(true),
            KeyCode::Enter => offset = (offset + 3).min(last),
            _ => {}
        }
    }
}

fn public_key_lines(value: &str, error: Option<&str>, width: usize) -> Vec<String> {
    let tail: String = value
        .chars()
        .rev()
        .take(width.saturating_sub(2))
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let mut lines = vec!["Choose your public key".into()];
    if let Some(message) = error {
        lines.push(format!("! {message}"));
    }
    lines.extend(["Public key file (.pub)".into(), format!("> {tail}")]);
    if error.is_none() {
        lines.extend([String::new(), "Private key must be usable by SSH.".into()]);
    }
    lines
}

fn public_key(tools: &first_access::Tools) -> io::Result<Option<first_access::PublicKey>> {
    let mut value = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join(".ssh/id_ed25519.pub").display().to_string())
        .unwrap_or_default();
    let mut error = None;
    loop {
        let (width, _) = terminal::size()?;
        let lines = public_key_lines(
            &value,
            error.as_deref(),
            usize::from(width).saturating_sub(4).min(76),
        );
        draw(&lines, 0, &footer("Review key", "Ctrl-U clear · Esc back"))?;
        match key()? {
            KeyCode::Esc => return Ok(None),
            KeyCode::Enter if !value.is_empty() && usable_size()? => {
                match first_access::prepare_public_key(&PathBuf::from(&value), tools) {
                    Ok(key) => return Ok(Some(key)),
                    Err(problem) => error = Some(problem.to_string()),
                }
            }
            KeyCode::Backspace => {
                value.pop();
                error = None;
            }
            KeyCode::Char('\u{15}') => {
                value.clear();
                error = None;
            }
            KeyCode::Char(character) if !character.is_control() && value.len() < 4096 => {
                value.push(character)
            }
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
    let mut lines = vec![
        "Choose an SSH key".into(),
        format!("Key {} of {}", selected + 1, keys.len()),
        String::new(),
    ];
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
        lines.push((*fingerprint).into());
    }
    lines
}

fn select_agent_key(mut keys: Vec<first_access::AgentKey>) -> io::Result<Option<SelectedKey>> {
    if keys.is_empty() {
        return Ok(None);
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
            &footer("Review this key", "↑/↓ select · Esc back"),
        )?;
        match key()? {
            KeyCode::Esc => return Ok(None),
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

fn choose_key_source(
    tools: &first_access::Tools,
    agent_only: bool,
) -> io::Result<Option<SelectedKey>> {
    loop {
        let Some(source) = choose(
            &[
                "Choose a key source".into(),
                "Private keys stay on your Mac.".into(),
            ],
            if agent_only {
                &["1Password SSH agent", "Current SSH agent"]
            } else {
                &[
                    "1Password SSH agent",
                    "Current SSH agent",
                    "Public-key file",
                ]
            },
        )?
        else {
            return Ok(None);
        };
        if source == 2 {
            return Ok(public_key(tools)?.map(|key| SelectedKey {
                key,
                identity: None,
            }));
        }
        let socket = if source == 0 {
            std::env::var_os("HOME").map(PathBuf::from).map(|home| {
                home.join("Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock")
            })
        } else {
            std::env::var_os("SSH_AUTH_SOCK").map(PathBuf::from)
        };
        let Some(socket) = socket else {
            review(
                &[
                    "SSH agent not configured".into(),
                    "Enable the SSH agent in 1Password, or choose a public-key file.".into(),
                ],
                "Choose another source",
            )?;
            continue;
        };
        loop {
            draw(
                &[
                    "Reading agent public keys".into(),
                    "Your SSH agent may ask you to unlock or approve.".into(),
                ],
                0,
                "Please wait",
            )?;
            match first_access::list_agent_keys(&socket, tools) {
                Ok(keys) => match select_agent_key(keys)? {
                    Some(key) => return Ok(Some(key)),
                    None => break,
                },
                Err(error) => {
                    let next = choose(
                        &[
                            "SSH agent unavailable".into(),
                            error.to_string(),
                            error.next_action().into(),
                        ],
                        &["Try again", "Choose another source"],
                    )?;
                    if next != Some(0) {
                        break;
                    }
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

fn connect(
    profile: &mut HostProfile,
    inventory_path: &Path,
    tools: &first_access::Tools,
    terminal: &mut Terminal,
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
                            "Trust this Mac?".into(),
                            format!("{}@{}", profile.user, profile.address),
                            String::new(),
                            "Trust: save the first SSH host key.".into(),
                            "Identity: not independently verified.".into(),
                            "Changed keys: still blocked.".into(),
                        ],
                        "Trust and check",
                    )? {
                        continue;
                    }
                    changes.trust_attempted = true;
                    first_access::Trust::AcceptNew
                } else {
                    first_access::Trust::Strict
                };
                draw(
                    &[
                        "Checking SSH access".into(),
                        "Trying your SSH identity. No password prompt.".into(),
                        "Your SSH agent may ask you to approve.".into(),
                    ],
                    0,
                    "Please wait",
                )?;
                first_access::check_key_access(profile, tools, trust)
            }
            AccessAction::InstallKey => {
                let Some(selected_key) = choose_key_source(tools, false)? else {
                    continue;
                };
                let is_agent = selected_key.identity.is_some();
                let route = if is_agent {
                    "Route: direct SSH, port 22. Ignore custom SSH configuration."
                } else {
                    "Route: existing SSH configuration. Clear the saved agent-key selection."
                };
                if !review(
                    &[
                        "Use this key for this Mac?".into(),
                        format!("{}@{}", profile.user, profile.address),
                        format!("Fingerprint: {}", selected_key.key.fingerprint()),
                        String::new(),
                        "Remember this public key for this Mac.".into(),
                        route.into(),
                        String::new(),
                        if is_agent {
                            "Check the selected key first. Install only if authentication is denied."
                        } else {
                            "Install this public key, then verify configured SSH access."
                        }.into(),
                        String::new(),
                        "Installation".into(),
                        "• Keep all existing public keys".into(),
                        "• .ssh permissions: 0700".into(),
                        "• authorized_keys permissions: 0600".into(),
                        "Password: entered in SSH, never stored.".into(),
                        "Interrupted install may leave the key.".into(),
                    ],
                    "Use this key",
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
                    draw(
                        &[
                            "Checking this SSH identity".into(),
                            "Your SSH agent may ask you to approve.".into(),
                        ],
                        0,
                        "Please wait",
                    )?;
                    installation_required(first_access::check_key_access(
                        profile,
                        tools,
                        first_access::Trust::Strict,
                    ))
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
                        terminal.suspend()?;
                        println!(
                            "Installing your approved public key. Enter the target account password at SSH's prompt."
                        );
                        let result =
                            first_access::install_public_key(profile, tools, &selected_key.key);
                        if result.is_err() {
                            println!(
                                "Read SSH's message above. Press Enter to return to the setup menu."
                            );
                            let mut acknowledgement = String::new();
                            io::stdin().read_line(&mut acknowledgement)?;
                        }
                        terminal.resume()?;
                        result
                    }
                }
            }
        };
        if let Err(error) = result {
            let (title, message, next) = failure_screen(&error);
            screen = vec![
                title.into(),
                format!("{}@{}", profile.user, profile.address),
                message.into(),
            ];
            actions = next;
            continue;
        }
        draw(
            &[
                "Reading host details".into(),
                "SSH connected. Checking macOS, account and storage.".into(),
                "Your SSH agent may ask you to approve.".into(),
            ],
            0,
            "Please wait",
        )?;
        let inspection = match inspect::inspect(profile, &tools.ssh) {
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
            return Ok(AccessOutcome::Continue(changes));
        }
        let mut lines = vec![
            "SSH access verified".into(),
            format!("macOS {} | {}", inspection.mac_os, inspection.architecture),
            format!(
                "{} (UID {}) | {:.1} GiB free",
                inspection.user, inspection.uid, inspection.free_gib
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

pub(crate) fn attached_workspace(path: &Path) -> io::Result<Option<config::Workspace>> {
    draw(
        &[
            "Loading configuration".into(),
            "Reading the attached repository through GitHub CLI.".into(),
        ],
        0,
        "Please wait",
    )?;
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
        draw(
            &[
                "Attach your configuration".into(),
                "GitHub repository: owner/name".into(),
                "The CLI reads homelab.json at a pinned commit.".into(),
                format!("> {repository}"),
            ],
            0,
            &footer("Open repository", "Ctrl-U clear · Esc back"),
        )?;
        match key()? {
            KeyCode::Esc => return Ok(None),
            KeyCode::Backspace => {
                repository.pop();
            }
            KeyCode::Char('\u{15}') => repository.clear(),
            KeyCode::Char(character) if character.is_ascii_graphic() && repository.len() < 200 => {
                repository.push(character)
            }
            KeyCode::Enter if usable_size()? => {
                draw(
                    &["Reading repository".into(), repository.clone()],
                    0,
                    "Please wait",
                )?;
                match config::attach(&repository, path) {
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
}

impl Default for EnrollmentDependencies {
    fn default() -> Self {
        Self {
            check_client_tools: crate::enrollment_credentials::check_client_tools,
            prepare_credentials: |root, host, workspace, started, progress| {
                crate::enrollment_credentials::prepare(root, host, workspace, started, progress)
            },
            tailscale: None,
        }
    }
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
    run_with_dependencies(original, inventory_path, tools, dependencies, &mut terminal)
}

fn run_with_dependencies(
    original: &HostProfile,
    inventory_path: &Path,
    tools: &WizardTools,
    dependencies: &EnrollmentDependencies,
    terminal: &mut Terminal,
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
                "Bind existing preparation".into(),
                format!("Repository: {}",workspace.repository),
                format!("Private state: {}",root.display()),
                format!("Existing hosts: {}",legacy_hosts.join(", ")),
                "Existing identities will be bound to this repository. Continue only if they belong to it.".into(),
            ],"Bind existing preparation")? {return Ok(cancelled(changes));}
        }
        if let Err(error) = crate::provisioning::bind_repository(root, &workspace.repository) {
            return Ok(Outcome {
                completed: false,
                lines: vec![error.to_string(), error.next_action().into()],
            });
        }
    }

    match state {
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
    Outcome {
        completed: false,
        lines: vec![
            "Setup needs attention".into(),
            error.to_string(),
            "Existing saved progress and recovery identities are preserved.".into(),
        ],
    }
}

fn remote_setup_failure(error: remote_setup::Error) -> Outcome {
    enrollment_failure(format!("{error} {}", error.next_action()))
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
    while event::poll(std::time::Duration::ZERO)? {
        if let Event::Key(key) = event::read()?
            && (key.code == KeyCode::Esc
                || (key.code == KeyCode::Char('c')
                    && key.modifiers.contains(KeyModifiers::CONTROL)))
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
            "Setup saved. Reopen setup to continue from this PR.".into(),
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
    terminal: &mut Terminal,
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
        let Some(selected) = choose_key_source(&tools.first_access, true)? else {
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
    if !review(
        &[
            format!("Set up {host_name}"),
            format!(
                "{}@{} · {:.0} GiB free",
                profile.user, profile.address, inspection.free_gib
            ),
            format!("Configuration: {}", workspace.repository),
            String::new(),
            "Install Apple's Command Line Tools if this Mac needs them.".into(),
            "Back up recovery keys to 1Password and prepare encrypted configuration.".into(),
            "Give this Mac read-only repository access and open an enrollment PR.".into(),
            "After you merge that PR, install its approved configuration on this Mac.".into(),
            "Restart the Mac, verify its services and remote access, then hand over to Git updates.".into(),
            "If FileVault is enabled, you may need to unlock the Mac locally after restart.".into(),
        ],
        "Begin setup",
    )? {
        return Ok(enrollment_failure(
            "Setup cancelled before credential preparation.",
        ));
    }
    if prerequisites == remote_setup::Prerequisites::DeveloperToolsMissing {
        let package = match package::prepare(workspace) {
            Ok(package) => package,
            Err(error) => return Ok(enrollment_failure(error)),
        };
        terminal.suspend()?;
        println!(
            "Installing required Command Line Tools on {host_name}. Enter that Mac's administrator password if asked."
        );
        if let Err(error) = remote_setup::install_developer_tools(
            profile,
            &package.directory.join("homelab-host"),
            &tools.remote_setup,
        ) {
            return Ok(remote_setup_failure(error));
        }
        terminal.resume()?;
    }
    let progress = |message: &str| {
        let _ = draw(
            &[format!("Setting up {host_name}"), message.into()],
            0,
            "Please wait",
        );
    };
    let attempt =
        match crate::provisioning::enrollment_attempt(root, &workspace.repository, host_name) {
            Ok(attempt) => attempt,
            Err(error) => return Ok(enrollment_failure(error)),
        };
    loop {
        let current_workspace = match saved_installation_workspace(profile) {
            Ok(Some(workspace)) => workspace,
            Ok(None) => match config::fetch(&workspace.repository) {
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
        progress("Preparing this Mac's read-only Git access");
        let package = match package::prepare(workspace) {
            Ok(package) => package,
            Err(error) => return Ok(enrollment_failure(error)),
        };
        let identity = match remote_setup::prepare_git_identity(
            profile,
            &attempt,
            &package.directory.join("homelab-host"),
            &tools.remote_setup,
        ) {
            Ok(identity) => identity,
            Err(error) => return Ok(remote_setup_failure(error)),
        };
        if let Some(revision) = &identity.activated_revision {
            let installed = match config::fetch_revision(&workspace.repository, revision) {
                Ok(workspace) => workspace,
                Err(error) => return Ok(enrollment_failure(error)),
            };
            terminal.suspend()?;
            return Ok(finish_enrollment(
                profile,
                host_name,
                &installed,
                tools,
                dependencies,
            ));
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
        let credentials = match (dependencies.prepare_credentials)(
            root,
            host_name,
            workspace,
            identity.bootstrap_started,
            &progress,
        ) {
            Ok(prepared) => prepared,
            Err(error) => return Ok(enrollment_failure(error)),
        };
        let registry = crate::deploy_keys::GitHub::new(Path::new("gh"));
        if let Err(error) = crate::deploy_keys::register_saved(
            &registry,
            &crate::deploy_keys::Request {
                repository: workspace.repository.clone(),
                host: host_name.into(),
                public_key: identity.public_key,
            },
            &directory.join("deploy-key.json"),
        ) {
            return Ok(enrollment_failure(error));
        }
        progress("Preparing the enrollment pull request");
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
        let pull = match crate::configuration_pr::publish(&api, &proposal) {
            Ok(pull) => pull,
            Err(error) => return Ok(enrollment_failure(error)),
        };
        let approved = loop {
            match crate::configuration_pr::approved_workspace(&api, &proposal, pull.number) {
                Ok(Some(workspace)) => {
                    if queued_cancellation()? {
                        return Ok(save_and_release(
                            &pull.html_url,
                            profile,
                            &attempt,
                            &package.directory.join("homelab-host"),
                            &tools.remote_setup,
                            identity.bootstrap_started,
                        ));
                    }
                    break workspace;
                }
                Ok(None) => {}
                Err(error) => return Ok(enrollment_failure(error)),
            }
            draw(
            &[
                format!("Waiting for approval · {host_name}"),
                "Review and merge the enrollment PR in GitHub.".into(),
                pull.html_url.clone(),
                String::new(),
                "Setup continues automatically after merge. You can close this and resume later."
                    .into(),
            ],
            0,
            "Enter Open PR · Esc Save and exit",
        )?;
            if event::poll(std::time::Duration::from_secs(5))? {
                match key()? {
                    KeyCode::Esc => {
                        return Ok(save_and_release(
                            &pull.html_url,
                            profile,
                            &attempt,
                            &package.directory.join("homelab-host"),
                            &tools.remote_setup,
                            identity.bootstrap_started,
                        ));
                    }
                    KeyCode::Enter => {
                        let expected = format!(
                            "https://github.com/{}/pull/{}",
                            workspace.repository, pull.number
                        );
                        if pull.html_url == expected {
                            let _ = std::process::Command::new("/usr/bin/open")
                                .arg(expected)
                                .stdin(std::process::Stdio::null())
                                .stdout(std::process::Stdio::null())
                                .stderr(std::process::Stdio::null())
                                .status();
                        }
                    }
                    _ => {}
                }
            }
        };
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
            Ok(false) if has_approval => {
                return Ok(enrollment_failure(
                    crate::enrollment_credentials::Error::ExpiredApprovedSetup,
                ));
            }
            Ok(false) => continue,
            Err(error) => return Ok(enrollment_failure(error)),
        }
        progress("Preparing the approved installation");
        let package = match package::prepare(&approved) {
            Ok(package) => package,
            Err(error) => return Ok(enrollment_failure(error)),
        };
        let prepared = match remote_setup::prepare(
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
            },
            &tools.remote_setup,
        ) {
            Ok(prepared) => prepared,
            Err(error) => return Ok(remote_setup_failure(error)),
        };
        if queued_cancellation()? {
            return Ok(save_and_release(
                &pull.html_url,
                profile,
                &attempt,
                &package.directory.join("homelab-host"),
                &tools.remote_setup,
                identity.bootstrap_started,
            ));
        }
        if let Err(error) = crate::provisioning::save_approved_installation(
            root,
            &approved.repository,
            host_name,
            &approved.revision,
        ) {
            return Ok(enrollment_failure(error));
        }
        terminal.suspend()?;
        println!("Installing on {host_name}. SSH may ask for the Mac's administrator password.");
        return match remote_setup::apply(prepared, &tools.remote_setup) {
            Ok(_) => Ok(finish_enrollment(
                profile,
                host_name,
                &approved,
                tools,
                dependencies,
            )),
            Err(error) => Ok(remote_setup_failure(error)),
        };
    }
}

fn finish_enrollment(
    profile: &HostProfile,
    host: &str,
    workspace: &config::Workspace,
    tools: &WizardTools,
    dependencies: &EnrollmentDependencies,
) -> Outcome {
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
            repository: &workspace.repository,
            host,
            revision: &workspace.revision,
            tag: &tailscale.tag,
        },
        |message| println!("{message}"),
    ) {
        Ok(report) => Outcome {
            completed: true,
            lines: vec![
                format!("{host} is set up."),
                "Reboot, services, Tailscale access and Git access verified.".into(),
                format!("Setup configuration: {}", workspace.revision),
                format!("Tailscale: {}", report.tailscale.dns_name),
            ],
        },
        Err(error) => enrollment_failure(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let root = temporary.path().join(".local/state/homelab/provisioning");
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
                                activation_ready: false,
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
        draw(&["Back in setup".into()], 0, "Please wait").unwrap();
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
            "repos/example/config/contents/homelab.json?ref=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) cat <<'JSON'\n",
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
        let mut wait_for = |needle: &str, master: &mut File| {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                let mut bytes = [0; 4096];
                match master.read(&mut bytes) {
                    Ok(count) => output.push_str(&String::from_utf8_lossy(&bytes[..count])),
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
                    Err(error) => panic!("terminal failed: {error}"),
                }
                if output.contains(needle) {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "missing terminal prompt: {needle}; {output}"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
        };
        wait_for("Attach your configuration", &mut master);
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
        assert_eq!(tcgetattr(&slave).unwrap().local_modes, original);
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["repository"], "example/config");
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
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
        let help = footer("Review this key", "↑/↓ select · Esc back");
        assert_eq!(help.lines().count(), 1);
        assert_eq!(crate::ui::help_lines(&help, 36).len(), 2);
        assert!(!help.contains("SHA256"));
    }

    #[test]
    fn public_key_error_and_editable_path_fit_the_minimum_terminal() {
        let message = first_access::Error::InvalidKey.to_string();
        let lines = public_key_lines(
            "/a/long/directory/whose/key/is/not/valid.pub",
            Some(&message),
            36,
        );
        let visible = wrap(&lines[1..], 36);
        assert!(
            visible.len() <= 5,
            "error and path must fit above the two-line footer"
        );
        assert!(visible.first().unwrap().starts_with("! "));
        assert!(
            visible
                .iter()
                .any(|line| line.starts_with("> ") && line.ends_with("valid.pub"))
        );
        assert!(visible.iter().all(|line| line.chars().count() <= 36));
        let footer = wrap(
            &footer("Review key", "Ctrl-U clear · Esc back")
                .lines()
                .map(str::to_owned)
                .collect::<Vec<_>>(),
            36,
        );
        assert_eq!(footer.len(), 2);
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
