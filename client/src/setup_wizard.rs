//! Interactive first setup; credentials stay in files and sudo owns its terminal.

use std::io::{self, Write};
use std::path::PathBuf;

use crossterm::cursor::MoveTo;
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use crossterm::queue;
use crossterm::terminal::{self, Clear, ClearType};

use crate::inventory::HostProfile;
use crate::remote_setup::{self, Request, Tools};
use crate::tui::{Terminal, wrap};
use crate::{first_access, inspect};

const LABELS: [&str; 6] = [
    "Configuration host",
    "Reviewed commit (40 characters)",
    "Extracted bootstrap artifact directory",
    "This host's private age identity file",
    "Private GitHub read-token file",
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
            .take(width.saturating_sub(4))
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        vec![
            "Set up a Mac".into(),
            format!(
                "Profile: {}",
                profile
                    .name
                    .chars()
                    .take(width.saturating_sub(10))
                    .collect::<String>()
            ),
            format!("Step {} of 6", self.field + 1),
            String::new(),
            LABELS[self.field].into(),
            format!("> {tail}"),
            String::new(),
            if self.field == 0 || self.field == 5 {
                "Left/Right changes selection"
            } else if self.field == 1 {
                "Paste the exact reviewed commit"
            } else {
                "Enter a file path, never a secret value"
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
    let wrapped = wrap(lines, usize::from(width) - 1);
    let room = usize::from(height) - 3;
    for (row, line) in wrapped.iter().skip(offset).take(room).enumerate() {
        queue!(output, MoveTo(0, row as u16))?;
        write!(output, "{line}")?;
    }
    queue!(output, MoveTo(0, height - 2))?;
    write!(
        output,
        "{}",
        footer
            .chars()
            .take(usize::from(width) - 1)
            .collect::<String>()
    )?;
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
}

impl AccessChanges {
    fn append_notice(self, lines: &mut Vec<String>) {
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

#[derive(Debug, PartialEq, Eq)]
enum AccessAction {
    Check,
    Trust,
    InstallKey,
}

fn access_action(code: KeyCode, check_failed: bool) -> Option<AccessAction> {
    match code {
        KeyCode::Enter => Some(AccessAction::Check),
        KeyCode::Char('t') => Some(AccessAction::Trust),
        // An SSH failure is not an authentication diagnosis. Installation is
        // offered as an explicit choice, never inferred from an exit status.
        KeyCode::Char('k') if check_failed => Some(AccessAction::InstallKey),
        _ => None,
    }
}

fn review(lines: &[String], footer: &str) -> io::Result<bool> {
    let mut offset = 0;
    loop {
        let last = draw(lines, offset, footer)?;
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

fn public_key_path() -> io::Result<Option<PathBuf>> {
    let mut value = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join(".ssh/id_ed25519.pub").display().to_string())
        .unwrap_or_default();
    loop {
        let (width, _) = terminal::size()?;
        let tail: String = value
            .chars()
            .rev()
            .take(usize::from(width).saturating_sub(4))
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        draw(&[
            "Install your SSH public key".into(),
            "Choose an existing .pub file whose private key is available to your SSH configuration or agent.".into(),
            "Only the public key is copied. The private key stays on your Mac.".into(),
            format!("> {tail}"),
        ], 0, "Enter select - Backspace edit - Esc back")?;
        match key()? {
            KeyCode::Esc => return Ok(None),
            KeyCode::Enter if !value.is_empty() && usable_size()? => {
                return Ok(Some(PathBuf::from(value)));
            }
            KeyCode::Backspace => {
                value.pop();
            }
            KeyCode::Char(character) if !character.is_control() && value.len() < 4096 => {
                value.push(character)
            }
            _ => {}
        }
    }
}

enum AccessOutcome {
    Continue(AccessChanges),
    Finished(Outcome),
}

fn connect(profile: &HostProfile) -> io::Result<AccessOutcome> {
    let tools = first_access::Tools {
        ssh: PathBuf::from("/usr/bin/ssh"),
        ssh_keygen: PathBuf::from("/usr/bin/ssh-keygen"),
    };
    let mut terminal = Some(Terminal::enter()?);
    let mut changes = AccessChanges::default();
    let mut check_failed = false;
    let mut detail = Vec::new();
    let mut offset = 0;
    loop {
        let mut lines = vec![
            "Connect to your Mac".into(),
            format!("Target: {}@{}", profile.user, profile.address),
            "Enable Remote Login on the target Mac for this administrator. You do not need Remote Login on your personal Mac.".into(),
            "Enter checks existing SSH access using saved host keys.".into(),
            "T approves trust on first use: save the first host key returned by this address. This does not independently verify the Mac's identity. Use the target's address from local setup; changed saved keys are still blocked.".into(),
            "No bootstrap artifact or secret files are needed to verify access.".into(),
        ];
        lines.extend(detail.clone());
        if check_failed {
            lines.push("If you can log in with the target account's password, K lets you review and install your public key. Connection failure alone does not mean a key is missing.".into());
        }
        let last = draw(
            &lines,
            offset,
            if check_failed {
                "Enter retry - k key - t trust - Esc cancel"
            } else {
                "Enter check - t trust - PgDn more - Esc cancel"
            },
        )?;
        let code = key()?;
        match code {
            KeyCode::Esc => return Ok(AccessOutcome::Finished(cancelled(changes))),
            KeyCode::PageDown => {
                offset = (offset + 3).min(last);
                continue;
            }
            KeyCode::PageUp => {
                offset = offset.saturating_sub(3);
                continue;
            }
            KeyCode::Enter if offset < last => {
                offset = (offset + 3).min(last);
                continue;
            }
            _ => {}
        }
        if offset < last || !usable_size()? {
            continue;
        }
        let Some(action) = access_action(code, check_failed) else {
            continue;
        };
        let result = match action {
            AccessAction::Check | AccessAction::Trust => {
                let trust = if action == AccessAction::Trust {
                    changes.trust_attempted = true;
                    first_access::Trust::AcceptNew
                } else {
                    first_access::Trust::Strict
                };
                draw(
                    &["Checking configured SSH keys. No password will be requested.".into()],
                    0,
                    "Please wait for the connection check",
                )?;
                first_access::check_key_access(profile, &tools, trust)
            }
            AccessAction::InstallKey => {
                let Some(path) = public_key_path()? else {
                    continue;
                };
                let public_key = match first_access::prepare_public_key(&path, &tools) {
                    Ok(key) => key,
                    Err(error) => {
                        detail = vec![error.to_string(), format!("Next: {}", error.next_action())];
                        offset = 0;
                        continue;
                    }
                };
                if !review(&[
                    "Approve public-key installation".into(),
                    format!("Target: {}@{}", profile.user, profile.address),
                    format!("Public key: {}", public_key.fingerprint()),
                    "This adds access to the target account and restricts .ssh to mode 0700 and authorized_keys to 0600. Existing keys are preserved.".into(),
                    "SSH requests the target account's password in the normal terminal; the client does not read or store it. Interruption may leave the key installed: inspect before retrying, and do not reset saved host keys.".into(),
                ], "Enter install - PgDn more - Esc back")? { continue; }
                changes.key_attempted = true;
                drop(terminal.take());
                println!(
                    "Installing the approved public key. Enter the target account password only at SSH's prompt."
                );
                let result = first_access::install_public_key(profile, &tools, &public_key);
                terminal = Some(Terminal::enter()?);
                result
            }
        };
        let inspection = match result {
            Ok(()) => {
                draw(
                    &["SSH connected. Reading macOS, account and storage details.".into()],
                    0,
                    "Please wait for read-only inspection",
                )?;
                inspect::inspect(profile, &tools.ssh)
                    .map_err(|error| (error.to_string(), error.next_action()))
            }
            Err(error) => Err((error.to_string(), error.next_action())),
        };
        match inspection {
            Err((message, next)) => {
                check_failed = true;
                detail = vec![message, format!("Next: {next}")];
                offset = 0;
            }
            Ok(inspection) => {
                let mut lines = vec![
                    "SSH access verified. Host setup has not started.".into(),
                    format!(
                        "{}: macOS {} / {}",
                        profile.address, inspection.mac_os, inspection.architecture
                    ),
                    format!(
                        "Account: {} (UID {}) / free space: {:.1} GiB",
                        inspection.user, inspection.uid, inspection.free_gib
                    ),
                ];
                if inspection.is_ready() {
                    lines.push("Enter finishes here. Press S to continue to the reviewed bootstrap artifact and host-specific secret files.".into());
                } else {
                    lines.push("SSH works, but bootstrap is blocked: this host is not an Apple-silicon Mac.".into());
                    lines.push(inspection.next_action.into());
                    lines.push("Enter finishes the access check without starting setup.".into());
                }
                changes.append_notice(&mut lines);
                let mut offset = 0;
                loop {
                    let last = draw(
                        &lines,
                        offset,
                        if inspection.is_ready() {
                            "Enter finish - s setup - PgDn more"
                        } else {
                            "Enter finish - PgDn more"
                        },
                    )?;
                    match key()? {
                        KeyCode::PageDown => offset = (offset + 3).min(last),
                        KeyCode::PageUp => offset = offset.saturating_sub(3),
                        KeyCode::Enter if offset < last => offset = (offset + 3).min(last),
                        KeyCode::Esc => {
                            return Ok(AccessOutcome::Finished(Outcome {
                                lines,
                                completed: true,
                            }));
                        }
                        KeyCode::Enter if usable_size()? => {
                            return Ok(AccessOutcome::Finished(Outcome {
                                lines,
                                completed: true,
                            }));
                        }
                        KeyCode::Char('s')
                            if inspection.is_ready() && offset >= last && usable_size()? =>
                        {
                            return Ok(AccessOutcome::Continue(changes));
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}

fn usable_size() -> io::Result<bool> {
    let (width, height) = terminal::size()?;
    Ok(width >= 40 && height >= 12)
}

/// The parent menu suspends raw mode before entering this independently owned wizard.
pub fn launch(profile: &HostProfile) -> io::Result<Outcome> {
    let changes = match connect(profile)? {
        AccessOutcome::Finished(outcome) => return Ok(outcome),
        AccessOutcome::Continue(changes) => changes,
    };
    let terminal = Terminal::enter()?;
    let mut form = Form::new(profile);
    let tools = Tools {
        ssh: PathBuf::from("/usr/bin/ssh"),
        scp: PathBuf::from("/usr/bin/scp"),
    };
    let prepared = loop {
        let (width, _) = terminal::size()?;
        draw(
            &form.lines(profile, width.into()),
            0,
            "Enter next - Shift-Tab back - Esc cancel",
        )?;
        match key()? {
            KeyCode::Esc => return Ok(cancelled(changes)),
            KeyCode::Enter if form.field < 5 && usable_size()? => form.field += 1,
            KeyCode::Enter if usable_size()? => {
                draw(
                    &[
                        "Checking the artifact and inspecting SSH. No bootstrap changes yet."
                            .into(),
                    ],
                    0,
                    "Please wait",
                )?;
                match remote_setup::prepare(form.request(profile), &tools) {
                    Ok(prepared) => break prepared,
                    Err(error) => {
                        let lines =
                            vec![error.to_string(), format!("Next: {}", error.next_action())];
                        let mut offset = 0;
                        loop {
                            let last = draw(&lines, offset, "Enter edit - PgDn more - Esc cancel")?;
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
    let mut offset = 0;
    loop {
        let last = draw(&lines, offset, "PgUp/Dn review - Enter next - Esc cancel")?;
        match key()? {
            KeyCode::Esc => return Ok(cancelled(changes)),
            KeyCode::PageDown => offset = (offset + 3).min(last),
            KeyCode::PageUp => offset = offset.saturating_sub(3),
            KeyCode::Enter if offset >= last && usable_size()? => break,
            KeyCode::Enter => offset = (offset + 3).min(last),
            _ => {}
        }
    }
    let mut confirmation = String::new();
    loop {
        draw(&[
            "Approve setup".into(),
            format!("Type {} to begin.", form.values[0]),
            "Only host-specific files will be transferred. Your administrator password stays in the interactive SSH terminal.".into(),
            format!("> {confirmation}"),
        ], 0, "Enter approve - Esc cancel")?;
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
    fn connection_failure_only_offers_installation_after_an_explicit_choice() {
        assert_eq!(access_action(KeyCode::Char('k'), false), None);
        assert_eq!(
            access_action(KeyCode::Enter, true),
            Some(AccessAction::Check)
        );
        assert_eq!(
            access_action(KeyCode::Char('k'), true),
            Some(AccessAction::InstallKey)
        );
        assert_eq!(access_action(KeyCode::Esc, true), None);
    }

    #[test]
    fn first_use_trust_requires_its_own_action() {
        assert_eq!(
            access_action(KeyCode::Enter, false),
            Some(AccessAction::Check)
        );
        assert_eq!(
            access_action(KeyCode::Char('t'), false),
            Some(AccessAction::Trust)
        );
    }

    #[test]
    fn cancellation_does_not_claim_to_undo_first_access() {
        let untouched = cancelled(AccessChanges::default());
        assert_eq!(untouched.lines.len(), 1);
        let changed = cancelled(AccessChanges {
            trust_attempted: true,
            key_attempted: true,
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
