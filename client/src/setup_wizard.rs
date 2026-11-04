//! Interactive first setup; credentials stay in files and sudo owns its terminal.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crossterm::cursor::MoveTo;
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use crossterm::queue;
use crossterm::terminal::{self, Clear, ClearType};

use crate::inventory::{self, AgentIdentity, HostProfile};
use crate::remote_setup::{self, Request, Tools};
use crate::tui::{Terminal, footer, wrap, write_styled};
use crate::{first_access, inspect};

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
    fn new(profile: &HostProfile) -> Self {
        Self {
            values: [
                if profile.name == "homelab-mac-mini" {
                    "homelab-mac-mini"
                } else {
                    "homelab-macbook"
                }
                .into(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
            ],
            field: 0,
            resume: false,
        }
    }

    fn edit(&mut self, code: KeyCode) {
        match code {
            KeyCode::Left | KeyCode::Right if self.field == 0 => {
                self.values[0] = if self.values[0] == "homelab-macbook" {
                    "homelab-mac-mini"
                } else {
                    "homelab-macbook"
                }
                .into();
            }
            KeyCode::Left | KeyCode::Right if self.field == 5 => self.resume = !self.resume,
            KeyCode::BackTab => self.field = self.field.saturating_sub(1),
            KeyCode::Backspace if (1..5).contains(&self.field) => {
                self.values[self.field].pop();
            }
            KeyCode::Char(character)
                if (1..5).contains(&self.field)
                    && !character.is_control()
                    && self.values[self.field].len() < 4096 =>
            {
                self.values[self.field].push(character);
            }
            _ => {}
        }
    }

    fn request(&self, profile: &HostProfile) -> Request {
        Request {
            profile: profile.clone(),
            configuration_host: self.values[0].clone(),
            revision: self.values[1].clone(),
            artifact_directory: PathBuf::from(&self.values[2]),
            age_key: PathBuf::from(&self.values[3]),
            github_token: PathBuf::from(&self.values[4]),
            resume: self.resume,
        }
    }

    fn lines(&self, profile: &HostProfile, width: usize) -> Vec<String> {
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
            format!(
                "{} | Step {} of 6",
                profile
                    .name
                    .chars()
                    .take(width.saturating_sub(14))
                    .collect::<String>(),
                self.field + 1,
            ),
            String::new(),
            LABELS[self.field].into(),
            format!("> {tail}"),
            if self.field == 0 || self.field == 5 {
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

fn draw(lines: &[String], offset: usize, footer: &str) -> io::Result<usize> {
    let (width, height) = terminal::size()?;
    let mut output = io::stdout();
    queue!(output, MoveTo(0, 0), Clear(ClearType::All))?;
    if width < 40 || height < 12 {
        write!(output, "Enlarge terminal to 40 columns / 12 rows.")?;
        output.flush()?;
        return Ok(0);
    }
    let content_width = usize::from(width).saturating_sub(4).min(76);
    let footer = wrap(
        &footer.lines().map(str::to_owned).collect::<Vec<_>>(),
        content_width,
    );
    let Some((title, body)) = lines.split_first() else {
        return Ok(0);
    };
    let titles = wrap(std::slice::from_ref(title), content_width);
    let wrapped = wrap(body, content_width);
    let room = usize::from(height).saturating_sub(footer.len() + 4);
    queue!(output, MoveTo(2, 0))?;
    write_styled(
        &mut output,
        titles.first().map(String::as_str).unwrap_or(""),
        true,
        false,
    )?;
    let last = wrapped.len().saturating_sub(room);
    for (row, line) in wrapped.iter().skip(offset.min(last)).take(room).enumerate() {
        queue!(output, MoveTo(2, row as u16 + 2))?;
        write_styled(&mut output, line, false, false)?;
    }
    for (row, line) in footer.iter().enumerate() {
        queue!(
            output,
            MoveTo(2, height - footer.len() as u16 - 1 + row as u16)
        )?;
        write_styled(&mut output, line, false, true)?;
    }
    output.flush()?;
    Ok(wrapped.len().saturating_sub(room))
}

fn key() -> io::Result<KeyCode> {
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
            "Install your public key using the target account's password.",
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

fn choose(lines: &[String], actions: &[&str]) -> io::Result<Option<usize>> {
    let mut selected = 0;
    let mut offset = 0;
    loop {
        let mut content = lines.to_vec();
        if actions.len() > 1 {
            content.push(String::new());
            content.extend(actions.iter().enumerate().map(|(index, label)| {
                format!("{} {label}", if index == selected { ">" } else { " " })
            }));
        }
        let footer = footer(actions[selected], "↑/↓ select · Esc back");
        let last = draw(&content, offset, &footer)?;
        match key()? {
            KeyCode::Esc => return Ok(None),
            KeyCode::Enter if usable_size()? => return Ok(Some(selected)),
            KeyCode::Up => {
                selected = selected.saturating_sub(1);
                offset = last;
            }
            KeyCode::Down => {
                selected = (selected + 1).min(actions.len() - 1);
                offset = last;
            }
            KeyCode::PageDown => offset = (offset + 3).min(last),
            KeyCode::PageUp => offset = offset.saturating_sub(3),
            // Retain visible actions for users accustomed to the old shortcuts.
            KeyCode::Char(character) => {
                let label = match character.to_ascii_lowercase() {
                    'k' => "Install public key",
                    't' => "Review host trust",
                    's' => "Continue host setup",
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

fn review(lines: &[String], primary: &str) -> io::Result<bool> {
    let mut offset = 0;
    loop {
        let last = draw(
            lines,
            offset,
            &footer(primary, "PgUp/PgDn review · Esc back"),
        )?;
        if offset < last {
            draw(
                lines,
                offset,
                &footer("Read more before approval", "PgUp/PgDn review · Esc back"),
            )?;
        }
        match key()? {
            KeyCode::Esc => return Ok(false),
            KeyCode::PageDown => offset = (offset + 3).min(last),
            KeyCode::PageUp => offset = offset.saturating_sub(3),
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
        lines.push(String::new());
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
            usize::from(height).saturating_sub(6),
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
                "Select a public key. Private keys stay in your agent or on this Mac.".into(),
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
    Continue(AccessChanges),
    Finished(Outcome),
}

fn welcome(profile: &HostProfile) -> Vec<String> {
    vec![
        "Connect to your Mac".into(),
        format!("{}@{}", profile.user, profile.address),
        String::new(),
        "On the target: enable Remote Login for this account.".into(),
        "This checks existing keys. No setup files are needed.".into(),
    ]
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

fn connect(profile: &mut HostProfile, inventory_path: &Path) -> io::Result<AccessOutcome> {
    let tools = first_access::Tools {
        ssh: PathBuf::from("/usr/bin/ssh"),
        ssh_keygen: PathBuf::from("/usr/bin/ssh-keygen"),
        ssh_add: PathBuf::from("/usr/bin/ssh-add"),
    };
    let mut terminal = Some(Terminal::enter()?);
    let mut changes = AccessChanges::default();
    let mut existing_access_worked = false;
    let mut screen = welcome(profile);
    let mut actions = vec![AccessAction::Check];
    loop {
        let labels: Vec<_> = actions.iter().map(|action| action.label()).collect();
        let Some(selected) = choose(&screen, &labels)? else {
            return Ok(AccessOutcome::Finished(cancelled(changes)));
        };
        let result = match actions[selected] {
            AccessAction::Check | AccessAction::Trust => {
                let trust = if actions[selected] == AccessAction::Trust {
                    if !review(&[
                        "Trust this Mac?".into(),
                        format!("{}@{}", profile.user, profile.address), String::new(),
                        "! Save the first SSH identity returned by this address.".into(),
                        "Its identity is not independently verified. Continue only if you trust this first connection.".into(),
                        "Changed saved keys will still be blocked.".into(),
                    ], "Trust and check")? { continue; }
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
                first_access::check_key_access(profile, &tools, trust)
            }
            AccessAction::InstallKey => {
                let Some(selected_key) = choose_key_source(&tools)? else {
                    continue;
                };
                let is_agent = selected_key.identity.is_some();
                let route = if is_agent {
                    "Remember this key for this Mac. Connect directly to this address on port 22; custom SSH configuration is not used."
                } else {
                    "Use your existing SSH configuration and identities. Any previous agent-key selection for this Mac will be cleared."
                };
                if !review(
                    &[
                        "Use this key for this Mac?".into(),
                        format!("{}@{}", profile.user, profile.address),
                        format!("Fingerprint: {}", selected_key.key.fingerprint()),
                        route.into(),
                        String::new(),
                        if is_agent {
                            "Check this identity first. If needed, install its public key using the target password; existing keys stay."
                        } else {
                            "Install this public key using the target password; existing keys stay. Then verify your configured SSH access."
                        }.into(),
                        "Installation makes .ssh private (0700) and authorized_keys private (0600).".into(),
                        "If needed, SSH asks for the target password. The client does not store it.".into(),
                        "! An interrupted attempt may leave the key installed.".into(),
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
                        &tools,
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
                            first_access::install_public_key(profile, &tools, &selected_key.key);
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
            vec!["Finish", "Continue host setup"]
        } else {
            vec!["Finish"]
        };
        let choice = choose(&lines, &choices)?;
        if choice == Some(1) {
            return Ok(AccessOutcome::Continue(changes));
        }
        changes.append_notice(&mut lines);
        return Ok(AccessOutcome::Finished(Outcome {
            lines,
            completed: true,
        }));
    }
}

fn usable_size() -> io::Result<bool> {
    let (width, height) = terminal::size()?;
    Ok(width >= 40 && height >= 12)
}

/// The parent menu suspends raw mode before entering this independently owned wizard.
pub fn launch(original: &HostProfile, inventory_path: &Path) -> io::Result<Outcome> {
    let mut profile = original.clone();
    let changes = match connect(&mut profile, inventory_path)? {
        AccessOutcome::Finished(outcome) => return Ok(outcome),
        AccessOutcome::Continue(changes) => changes,
    };
    let terminal = Terminal::enter()?;
    let mut form = Form::new(&profile);
    let tools = Tools {
        ssh: PathBuf::from("/usr/bin/ssh"),
        scp: PathBuf::from("/usr/bin/scp"),
    };
    let prepared = loop {
        let (width, _) = terminal::size()?;
        draw(
            &form.lines(&profile, usize::from(width).saturating_sub(4).min(76)),
            0,
            &footer("Next", "Tab next · Shift-Tab back · Esc back"),
        )?;
        match key()? {
            KeyCode::Esc => return Ok(cancelled(changes)),
            KeyCode::Enter | KeyCode::Tab if form.field < 5 && usable_size()? => form.field += 1,
            KeyCode::Enter if usable_size()? => {
                draw(
                    &[
                        "Checking bootstrap readiness".into(),
                        "Validating artifact and SSH. No bootstrap changes yet.".into(),
                    ],
                    0,
                    "Please wait",
                )?;
                match remote_setup::prepare(form.request(&profile), &tools) {
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
                                &footer("Edit inputs", "PgUp/PgDn review · Esc back"),
                            )?;
                            match key()? {
                                KeyCode::Esc => return Ok(cancelled(changes)),
                                KeyCode::Enter => {
                                    form.field = 0;
                                    break;
                                }
                                KeyCode::PageDown => offset = (offset + 3).min(last),
                                KeyCode::PageUp => offset = offset.saturating_sub(3),
                                _ => {}
                            }
                        }
                    }
                }
            }
            code => form.edit(code),
        }
    };
    let mut lines = prepared.lines();
    lines.push("This will transfer host-specific credentials and apply the reviewed configuration. Migration and service health still require separate checks.".into());
    if !review(&lines, "Continue to approval")? {
        return Ok(cancelled(changes));
    }
    let mut confirmation = String::new();
    loop {
        draw(&[
            "Approve setup".into(),
            format!("Type {} to begin.", form.values[0]),
            "Only host-specific files will be transferred. Your administrator password stays in the interactive SSH terminal.".into(),
            format!("> {confirmation}"),
        ], 0, &footer("Approve setup", "Esc back"))?;
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
    let outcome = match remote_setup::apply(prepared, &tools) {
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
    fn profile() -> HostProfile {
        HostProfile {
            name: "lan-mini".into(),
            address: "mini".into(),
            user: "calum".into(),
            identity: None,
        }
    }
    #[test]
    fn configuration_selection_is_separate_from_the_connection_alias() {
        let profile = profile();
        let mut form = Form::new(&profile);
        form.edit(KeyCode::Right);
        let request = form.request(&profile);
        assert_eq!(request.configuration_host, "homelab-mac-mini");
        assert_eq!(request.profile.name, "lan-mini");
        assert!(!request.resume);
    }
    #[test]
    fn editing_retains_paths_and_requires_explicit_resume_selection() {
        let mut form = Form::new(&profile());
        form.field = 2;
        for c in "/private/path with spaces".chars() {
            form.edit(KeyCode::Char(c));
        }
        form.edit(KeyCode::BackTab);
        assert_eq!(form.values[2], "/private/path with spaces");
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
    fn welcome_is_short_and_has_no_hidden_install_or_trust_instruction() {
        let lines = welcome(&profile());
        let wrapped = wrap(&lines[1..], 36);
        assert!(wrapped.len() <= 6, "welcome must fit the minimum terminal");
        assert!(
            lines
                .iter()
                .all(|line| !line.contains("K lets") && !line.contains("T approves"))
        );
        assert!(
            wrapped.iter().any(String::is_empty),
            "keep visual separation"
        );
    }

    #[test]
    fn bootstrap_form_keeps_the_path_tail_visible_at_minimum_size() {
        let profile = profile();
        let mut form = Form::new(&profile);
        form.field = 2;
        form.values[2] = "/a/long/private/directory/reviewed-bootstrap-artifact".into();
        let lines = form.lines(&profile, 36);
        let body = wrap(&lines[1..], 36);
        assert!(body.len() <= 6, "form must fit above the two-line footer");
        assert!(
            body.iter()
                .any(|line| line.starts_with("> ") && line.ends_with("bootstrap-artifact"))
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
            for (width, room) in [(36, 6), (76, 18)] {
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
    fn public_key_error_and_editable_path_fit_the_minimum_terminal() {
        let message = first_access::Error::InvalidKey.to_string();
        let lines = public_key_lines(
            "/a/long/directory/whose/key/is/not/valid.pub",
            Some(&message),
            36,
        );
        let visible = wrap(&lines[1..], 36);
        assert!(
            visible.len() <= 6,
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
