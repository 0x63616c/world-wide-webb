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

const LABELS: [&str; 6] = [
    "Configuration host",
    "Reviewed commit (40 characters)",
    "Bootstrap artifact directory",
    "Host age identity file (private)",
    "GitHub read-token file (private)",
    "Setup attempt",
];

struct Form {
    values: [String; 5],
    field: usize,
    resume: bool,
}

impl Form {
    fn new(configuration_host: &str) -> Self {
        Self {
            values: [
                configuration_host.into(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
            ],
            field: 3,
            resume: false,
        }
    }

    fn prefill_credentials(&mut self, root: &Path) {
        let directory = root.join("hosts").join(&self.values[0]);
        for (field, filename) in [(3, "host-age-key.txt"), (4, "github-read-token")] {
            let path = directory.join(filename);
            self.values[field] = if path.is_file() {
                path.display().to_string()
            } else {
                String::new()
            };
        }
        self.field = (3..5)
            .find(|field| self.values[*field].is_empty())
            .unwrap_or(5);
    }

    fn edit(&mut self, code: KeyCode) {
        match code {
            KeyCode::Left | KeyCode::Right if self.field == 5 => self.resume = !self.resume,
            KeyCode::BackTab => self.field = self.field.saturating_sub(1).max(3),
            KeyCode::Backspace if (3..5).contains(&self.field) => {
                self.values[self.field].pop();
            }
            KeyCode::Char(character)
                if (3..5).contains(&self.field)
                    && !character.is_control()
                    && self.values[self.field].len() < 4096 =>
            {
                self.values[self.field].push(character);
            }
            _ => {}
        }
    }

    fn request(&self, profile: &HostProfile, workspace: &config::Workspace) -> Request {
        Request {
            profile: profile.clone(),
            repository: workspace.repository.clone(),
            configuration_host: self.values[0].clone(),
            revision: self.values[1].clone(),
            artifact_directory: PathBuf::from(&self.values[2]),
            age_key: PathBuf::from(&self.values[3]),
            github_token: PathBuf::from(&self.values[4]),
            resume: self.resume,
        }
    }

    fn lines(&self, _profile: &HostProfile, width: usize) -> Vec<String> {
        let value = if self.field == 5 {
            if self.resume {
                "Resume a verified safe phase"
            } else {
                "New setup"
            }
        } else {
            &self.values[self.field]
        };
        let tail: String = value
            .chars()
            .rev()
            .take(width.saturating_sub(2))
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        vec![
            "Set up a Mac".into(),
            format!("Host: {}", self.values[0]),
            String::new(),
            LABELS[self.field].into(),
            format!("> {tail}"),
            if self.field == 5 {
                "←/→ changes selection"
            } else if self.field == 1 {
                "Paste the exact reviewed commit"
            } else {
                "Path only; never paste a secret."
            }
            .into(),
        ]
    }
}

fn render(title: &str, body: &[(String, Role)], offset: usize, footer: &str) -> io::Result<usize> {
    let (width, height) = terminal::size()?;
    let mut output = io::stdout();
    queue!(output, MoveTo(0, 0), Clear(ClearType::All))?;
    if width < 40 || height < 12 {
        write!(output, "Enlarge terminal to 40 columns / 12 rows.")?;
        output.flush()?;
        return Ok(0);
    }
    let width = ui::content_width(width);
    let footer = wrap(
        &footer.lines().map(str::to_owned).collect::<Vec<_>>(),
        width,
    );
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
    output.flush()?;
    Ok(last)
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

fn choose_key_source(tools: &first_access::Tools) -> io::Result<Option<SelectedKey>> {
    loop {
        let Some(source) = choose(
            &[
                "Choose a key source".into(),
                "Private keys stay on your Mac.".into(),
            ],
            &[
                "1Password SSH agent",
                "Current SSH agent",
                "Public-key file",
            ],
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
    Continue(AccessChanges, usize),
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
) -> io::Result<AccessOutcome> {
    let mut terminal = Some(Terminal::enter()?);
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
                let Some(selected_key) = choose_key_source(tools)? else {
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
                        drop(terminal.take());
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
                        terminal = Some(Terminal::enter()?);
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
        let choices = if inspection.is_ready() {
            vec!["Prepare credentials", "Review & set up", "Finish"]
        } else {
            vec!["Finish"]
        };
        let choice = choose(&lines, &choices)?;
        if inspection.is_ready()
            && let Some(mode @ 0..=1) = choice
        {
            return Ok(AccessOutcome::Continue(changes, mode));
        }
        changes.append_notice(&mut lines);
        return Ok(AccessOutcome::Finished(Outcome {
            lines,
            completed: true,
        }));
    }
}

pub(crate) fn usable_size() -> io::Result<bool> {
    let (width, height) = terminal::size()?;
    Ok(width >= 40 && height >= 12)
}

fn approval_lines(host: &str, confirmation: &str) -> Vec<String> {
    vec![
        "Approve setup".into(),
        format!("Type {host} to begin."),
        "Apply the reviewed configuration.".into(),
        format!("> {confirmation}"),
    ]
}

fn attached_workspace(path: &Path) -> io::Result<Option<config::Workspace>> {
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
            &footer("Review attachment", "Ctrl-U clear · Esc back"),
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
                if !review(&["Attach repository?".into(), repository.clone(), "Read its configuration through gh and remember this repository for this inventory.".into(), "No credentials are read or deployed.".into()], "Attach repository")? { continue; }
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

/// The parent menu suspends raw mode before entering this independently owned wizard.
pub struct WizardTools {
    pub first_access: first_access::Tools,
    pub remote_setup: remote_setup::Tools,
}

pub fn launch(original: &HostProfile, inventory_path: &Path) -> io::Result<Outcome> {
    launch_with_tools(
        original,
        inventory_path,
        &WizardTools {
            first_access: first_access::Tools {
                ssh: "/usr/bin/ssh".into(),
                ssh_keygen: "/usr/bin/ssh-keygen".into(),
                ssh_add: "/usr/bin/ssh-add".into(),
            },
            remote_setup: remote_setup::Tools {
                ssh: "/usr/bin/ssh".into(),
                scp: "/usr/bin/scp".into(),
            },
        },
    )
}

/// Runs the same guided journey with explicit transport executables for isolated tests.
pub fn launch_with_tools(
    original: &HostProfile,
    inventory_path: &Path,
    tools: &WizardTools,
) -> io::Result<Outcome> {
    let mut profile = original.clone();
    let (changes, mode) = match connect(&mut profile, inventory_path, &tools.first_access)? {
        AccessOutcome::Finished(outcome) => return Ok(outcome),
        AccessOutcome::Continue(changes, mode) => (changes, mode),
    };
    let terminal = Terminal::enter()?;
    let Some(workspace) = attached_workspace(&inventory_path.with_file_name("repository.json"))?
    else {
        return Ok(cancelled(changes));
    };
    let configuration_host = match configured_host(&profile, &workspace) {
        Some(host) => host.to_owned(),
        None => {
            let hosts: Vec<&str> = workspace
                .manifest
                .hosts
                .keys()
                .map(String::as_str)
                .collect();
            let Some(selected) = choose(
                &[
                    "Choose configuration".into(),
                    format!("Connection: {}", profile.name),
                    "Remember which repository host this connection manages.".into(),
                ],
                &hosts,
            )?
            else {
                return Ok(cancelled(changes));
            };
            let host = hosts[selected];
            match inventory::set_configuration(inventory_path, &profile, host) {
                Ok(updated) => profile = updated,
                Err(error) => {
                    return Ok(Outcome {
                        completed: false,
                        lines: vec![
                        "Configuration was not saved. No credentials were prepared or transferred."
                            .into(),
                        error.to_string(),
                        error.next_action().into(),
                    ],
                    });
                }
            }
            host.to_owned()
        }
    };
    let state = crate::provision_wizard::state_directory();
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

    if mode == 0 {
        return match state {
            Some(root) => crate::provision_wizard::launch(&root, &configuration_host, &workspace),
            None => Ok(Outcome {
                completed: false,
                lines: vec!["HOME is unavailable. Local credentials were not prepared.".into()],
            }),
        };
    }
    let host = &workspace.manifest.hosts[&configuration_host];
    if !review(&[
        "Review private configuration".into(),
        format!("Repository: {}", workspace.repository),
        format!("Revision: {}", workspace.revision),
        format!("Host: {configuration_host}"),
        format!("Administrator: {} (UID {})", host.admin_user, host.admin_uid),
        format!("Services: {}", if host.services.is_empty() { "none".into() } else { host.services.join(", ") }),
        "Use the installed public helper. Target Nix must match this manifest before activation.".into(),
    ], "Prepare setup")? { return Ok(cancelled(changes)); }
    let package = match package::prepare(&workspace) {
        Ok(package) => package,
        Err(error) => {
            return Ok(Outcome {
                completed: false,
                lines: vec!["Bootstrap package unavailable".into(), error.to_string()],
            });
        }
    };
    let mut form = Form::new(&configuration_host);
    form.values[1] = workspace.revision.clone();
    form.values[2] = package.directory.display().to_string();
    if let Some(root) = &state {
        form.prefill_credentials(root);
    }
    let tools = &tools.remote_setup;
    let prepared = loop {
        let (width, _) = terminal::size()?;
        draw(
            &form.lines(&profile, usize::from(width).saturating_sub(4).min(76)),
            0,
            &footer("Next", "Tab/Shift-Tab edit · Esc back"),
        )?;
        match key()? {
            KeyCode::Esc => return Ok(cancelled(changes)),
            KeyCode::Enter | KeyCode::Tab if form.field < 5 && usable_size()? => {
                form.field = ((form.field + 1)..5)
                    .find(|field| form.values[*field].is_empty())
                    .unwrap_or(5);
            }
            KeyCode::Enter if usable_size()? => {
                draw(
                    &[
                        "Checking bootstrap readiness".into(),
                        "Validating artifact and SSH. No bootstrap changes yet.".into(),
                    ],
                    0,
                    "Please wait",
                )?;
                match remote_setup::prepare(form.request(&profile, &workspace), tools) {
                    Ok(prepared) => break prepared,
                    Err(error) => {
                        let lines = vec![
                            "Bootstrap preparation blocked".into(),
                            error.to_string(),
                            String::new(),
                            format!("Next: {}", error.next_action()),
                        ];
                        let mut offset = 0;
                        loop {
                            let last = draw(
                                &lines,
                                offset,
                                &footer("Edit inputs", "↑/↓ read · Esc back"),
                            )?;
                            match key()? {
                                KeyCode::Esc => return Ok(cancelled(changes)),
                                KeyCode::Enter => {
                                    form.field = 3;
                                    break;
                                }
                                KeyCode::Down | KeyCode::PageDown => {
                                    offset = (offset + 1).min(last)
                                }
                                KeyCode::Up | KeyCode::PageUp => offset = offset.saturating_sub(1),
                                _ => {}
                            }
                        }
                    }
                }
            }
            code => form.edit(code),
        }
    };
    let mut lines = vec!["Review & set up".into()];
    lines.extend(prepared.lines());
    lines.push("This will transfer host-specific credentials and apply the reviewed configuration. Migration and service health still require separate checks.".into());
    if !review(&lines, "Continue to approval")? {
        return Ok(cancelled(changes));
    }
    let mut confirmation = String::new();
    loop {
        draw(
            &approval_lines(&form.values[0], &confirmation),
            0,
            &footer("Approve setup", "Esc back"),
        )?;
        match key()? {
            KeyCode::Esc => return Ok(cancelled(changes)),
            KeyCode::Backspace => {
                confirmation.pop();
            }
            KeyCode::Char(character) if character.is_ascii_alphanumeric() || character == '-' => {
                if confirmation.len() < 32 {
                    confirmation.push(character);
                }
            }
            KeyCode::Enter if confirmation == form.values[0] && usable_size()? => break,
            _ => {}
        }
    }
    // SSH and sudo need a normal terminal, including echo handling for passwords.
    drop(terminal);
    println!(
        "Starting approved setup on {}. SSH may request administrator authentication.",
        profile.address
    );
    let outcome = match remote_setup::apply(prepared, tools) {
        Ok(report) => Outcome {
            lines: report.lines(),
            completed: true,
        },
        Err(error) => Outcome {
            lines: vec![error.to_string(), format!("Next: {}", error.next_action())],
            completed: false,
        },
    };
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn workspace() -> config::Workspace {
        config::Workspace {
            repository: "example/config".into(),
            revision: "a".repeat(40),
            manifest: config::Manifest {
                schema: 1,
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
    fn attach_terminal_child() {
        let Some(path) = std::env::var_os("HOMELAB_ATTACH_TEST_PATH") else {
            return;
        };
        let terminal = Terminal::enter().unwrap();
        let workspace = attached_workspace(Path::new(&path)).unwrap().unwrap();
        assert_eq!(workspace.repository, "example/config");
        assert!(workspace.manifest.hosts.contains_key("test-host"));
        drop(terminal);
        println!("ATTACH_COMPLETE");
    }

    #[test]
    fn terminal_attach_reviews_and_persists_one_repository_using_only_fake_gh() {
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
        master.write_all(b"example/config\r").unwrap();
        wait_for("Attach repository?", &mut master);
        assert!(
            !path.exists(),
            "attachment requires explicit review approval"
        );
        for _ in 0..64 {
            master.write_all(b"\x1b[B").unwrap();
        }
        master.write_all(b"\r").unwrap();
        wait_for("ATTACH_COMPLETE", &mut master);
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
    #[ignore = "visual QA harness; synthetic inputs only"]
    fn render_preview() {
        let scene = std::env::var("HOMELAB_PREVIEW").unwrap();
        let _terminal = Terminal::enter().unwrap();
        let profile = profile();
        match scene.as_str() {
            "form" => {
                let mut form = Form::new("build-mac");
                form.field = 3;
                form.values[3] = "/Users/operator/private/host-age-key.txt".into();
                draw(
                    &form.lines(&profile, ui::content_width(terminal::size().unwrap().0)),
                    0,
                    &footer("Next", "Tab/Shift-Tab edit · Esc back"),
                )
                .unwrap();
                key().unwrap();
            }
            "failure" => {
                let (title, message, actions) =
                    failure_screen(&first_access::Error::AuthenticationDenied);
                choose(
                    &[
                        title.into(),
                        "operator@macbook.local".into(),
                        message.into(),
                    ],
                    &actions
                        .iter()
                        .copied()
                        .map(AccessAction::label)
                        .collect::<Vec<_>>(),
                )
                .unwrap();
            }
            "source" => {
                choose_key_source(&first_access::Tools {
                    ssh: "/usr/bin/ssh".into(),
                    ssh_keygen: "/usr/bin/ssh-keygen".into(),
                    ssh_add: "/usr/bin/ssh-add".into(),
                })
                .unwrap();
            }
            "keys" => {
                let (width, height) = terminal::size().unwrap();
                let lines = agent_key_lines(
                    &[
                        (
                            "Personal Mac",
                            "SHA256:abcdefghijklmnopqrstuvwxy0123456789012345678",
                        ),
                        (
                            "Homelab",
                            "SHA256:zyxwvutsrqponmlkjihgfedcba9876543210987654321",
                        ),
                    ],
                    1,
                    ui::content_width(width),
                    usize::from(height).saturating_sub(7),
                );
                draw(
                    &lines,
                    0,
                    &footer("Review this key", "↑/↓ select · Esc back"),
                )
                .unwrap();
                key().unwrap();
            }
            "approval" => {
                draw(
                    &approval_lines("build-mac", "build-mac"),
                    0,
                    &footer("Approve setup", "Esc back"),
                )
                .unwrap();
                key().unwrap();
            }
            "review" => {
                review(
                    &[
                        "Review encryption".into(),
                        "Host: build-mac".into(),
                        String::new(),
                        "Host recipient: age1syntheticpublicrecipientforlayoutonly".into(),
                        "Recovery recipient: age1othersyntheticpublicrecipient".into(),
                        String::new(),
                        "Encrypted: Tailscale + GitHub tokens".into(),
                        "Bootstrap: GitHub token retained in an owner-only file outside Git."
                            .into(),
                        "No deployment will start.".into(),
                    ],
                    "Encrypt configuration",
                )
                .unwrap();
            }
            _ => panic!("unknown preview scene"),
        }
    }

    #[test]
    fn reviewed_configuration_prefills_only_existing_selected_host_credentials() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("hosts/build-mac");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("host-age-key.txt"), "synthetic").unwrap();
        std::fs::write(directory.join("github-read-token"), "synthetic").unwrap();
        let mut form = Form::new("build-mac");
        form.prefill_credentials(root.path());
        assert_eq!(
            Path::new(&form.values[3]),
            directory.join("host-age-key.txt")
        );
        assert_eq!(
            Path::new(&form.values[4]),
            directory.join("github-read-token")
        );
        let mut form = Form::new("service-mac");
        form.prefill_credentials(root.path());
        assert!(form.values[3].is_empty() && form.values[4].is_empty());
        assert!(!root.path().join("hosts/service-mac").exists());
    }

    #[test]
    fn configuration_selection_is_separate_from_the_connection_alias() {
        let profile = profile();
        let mut form = Form::new("service-mac");
        form.edit(KeyCode::Right);
        let request = form.request(&profile, &workspace());
        assert_eq!(request.configuration_host, "service-mac");
        assert_eq!(request.profile.name, "lan-mini");
        assert!(!request.resume);
    }
    #[test]
    fn saved_or_exact_configuration_stays_fixed_through_form_navigation() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("private/inventory.json");
        let alias = profile();
        assert!(alias.resolved_configuration().is_none());
        inventory::add(&path, alias.clone()).unwrap();
        inventory::set_configuration(&path, &alias, "service-mac").unwrap();
        let saved = inventory::load(&path).unwrap().remove(0);
        assert_eq!(saved.resolved_configuration(), Some("service-mac"));
        let mut exact = profile();
        exact.name = "build-mac".into();
        for profile in [saved, exact] {
            let workspace = workspace();
            let host = configured_host(&profile, &workspace).unwrap();
            let mut form = Form::new(host);
            assert_eq!(form.field, 3);
            for key in [
                KeyCode::BackTab,
                KeyCode::BackTab,
                KeyCode::Right,
                KeyCode::Left,
            ] {
                form.edit(key);
            }
            assert_eq!(form.field, 3);
            assert_eq!(form.request(&profile, &workspace).configuration_host, host);
        }
    }

    #[test]
    fn editing_retains_paths_and_requires_explicit_resume_selection() {
        let mut form = Form::new("build-mac");
        form.field = 3;
        for c in "/private/path with spaces".chars() {
            form.edit(KeyCode::Char(c));
        }
        form.edit(KeyCode::BackTab);
        assert_eq!(form.values[3], "/private/path with spaces");
        form.field = 5;
        form.edit(KeyCode::Right);
        assert!(form.resume);
        form.edit(KeyCode::Left);
        assert!(!form.resume);
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
    fn bootstrap_form_keeps_the_path_tail_visible_at_minimum_size() {
        let profile = profile();
        let mut form = Form::new("service-mac");
        form.field = 3;
        form.values[3] = "/a/long/private/directory/host-age-key.txt".into();
        let lines = form.lines(&profile, 36);
        let body = wrap(&lines[1..], 36);
        assert!(body.len() <= 6, "form must fit above the two-line footer");
        assert!(
            body.iter()
                .any(|line| line.starts_with("> ") && line.ends_with("host-age-key.txt"))
        );
        assert!(body.iter().all(|line| line.chars().count() <= 36));
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
        assert_eq!(help.lines().count(), 2);
        assert!(!help.contains("SHA256"));
    }

    #[test]
    fn final_approval_keeps_typed_host_visible_at_minimum_size() {
        let lines = approval_lines("build-mac", "build-mac");
        let visible = wrap(&lines[1..], 36);
        assert!(visible.len() <= 5);
        assert_eq!(visible.last().unwrap(), "> build-mac");
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
