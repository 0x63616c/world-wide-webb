//! Choose a saved connection or add a Mac to the setup wizard.

use std::io::{self, Write};
use std::path::Path;
use std::time::Duration;

use crossterm::cursor::{Hide, MoveTo, Show};
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::terminal::{self, Clear, ClearType, EnterAlternateScreen, LeaveAlternateScreen};
use crossterm::{execute, queue};
use thiserror::Error;

use crate::inventory::{self, HostProfile, InventoryError};
use crate::ui::{self, Role};

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
        terminal::enable_raw_mode()?;
        terminal.raw = true;
        // Mark before writing: an I/O failure can occur after a partial escape sequence.
        terminal.alternate = true;
        execute!(io::stdout(), EnterAlternateScreen, Hide)?;
        Ok(terminal)
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        if self.alternate {
            let _ = execute!(io::stdout(), Show, LeaveAlternateScreen);
        }
        if self.raw {
            let _ = terminal::disable_raw_mode();
        }
    }
}

#[derive(Default)]
struct Form {
    values: [String; 3],
    selected: usize,
    error: Option<InventoryError>,
}

enum Action {
    None,
    Quit,
    Save(HostProfile),
    Setup(HostProfile),
}

struct Menu {
    hosts: Vec<HostProfile>,
    selected: usize,
    details: Vec<String>,
    detail_offset: usize,
    details_open: bool,
    form: Option<Form>,
}

impl Menu {
    fn new(hosts: Vec<HostProfile>) -> Self {
        Self {
            hosts,
            selected: 0,
            details: Vec::new(),
            detail_offset: 0,
            details_open: false,
            form: None,
        }
    }

    fn key(&mut self, key: KeyEvent, width: usize) -> Action {
        if key.kind == KeyEventKind::Release {
            return Action::None;
        }
        let cancel = key.code == KeyCode::Esc
            || (key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL));
        if let Some(form) = &mut self.form {
            if cancel {
                self.form = None;
                return Action::None;
            }
            if form.error.is_some() {
                if key.code == KeyCode::Enter {
                    form.error = None;
                }
                return Action::None;
            }
            match key.code {
                KeyCode::Tab | KeyCode::Down => form.selected = (form.selected + 1) % 4,
                KeyCode::BackTab | KeyCode::Up => form.selected = (form.selected + 3) % 4,
                KeyCode::Enter if form.selected == 3 => {
                    let [name, address, user] = form.values.clone();
                    return Action::Save(HostProfile {
                        name,
                        address,
                        user,
                        identity: None,
                        configuration_host: None,
                    });
                }
                KeyCode::Enter => form.selected += 1,
                KeyCode::Backspace if form.selected < 3 => {
                    form.values[form.selected].pop();
                }
                KeyCode::Char(character)
                    if form.selected < 3
                        && character.is_ascii()
                        && !character.is_ascii_control()
                        && !key
                            .modifiers
                            .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
                        && form.values[form.selected].len() < 253 =>
                {
                    form.values[form.selected].push(character);
                }
                _ => {}
            }
            return Action::None;
        }
        if self.details_open {
            match key.code {
                KeyCode::Esc | KeyCode::Enter => {
                    self.details_open = false;
                    self.details.clear();
                }
                KeyCode::Up | KeyCode::PageUp => {
                    self.detail_offset = self.detail_offset.saturating_sub(1);
                }
                KeyCode::Down | KeyCode::PageDown => {
                    let last = wrap(&self.details, width.saturating_sub(4).clamp(1, 76))
                        .len()
                        .saturating_sub(1);
                    self.detail_offset = (self.detail_offset + 1).min(last);
                }
                _ if cancel || key.code == KeyCode::Char('q') => return Action::Quit,
                _ => {}
            }
            return Action::None;
        }
        if cancel || key.code == KeyCode::Char('q') {
            return Action::Quit;
        }
        match key.code {
            KeyCode::Enter | KeyCode::Char('s' | 'S') if !self.hosts.is_empty() => {
                return Action::Setup(self.hosts[self.selected].clone());
            }
            KeyCode::Char('n' | 'N') => self.form = Some(Form::default()),
            KeyCode::Enter if self.hosts.is_empty() => self.form = Some(Form::default()),
            KeyCode::Up if !self.hosts.is_empty() => {
                self.selected = (self.selected + self.hosts.len() - 1) % self.hosts.len();
                self.details.clear();
                self.detail_offset = 0;
            }
            KeyCode::Down if !self.hosts.is_empty() => {
                self.selected = (self.selected + 1) % self.hosts.len();
                self.details.clear();
                self.detail_offset = 0;
            }
            _ => {}
        }
        Action::None
    }

    fn save(&mut self, path: &Path, host: HostProfile) {
        match inventory::add(path, host) {
            Ok(hosts) => {
                self.selected = hosts.len() - 1;
                self.hosts = hosts;
                self.form = None;
                self.details = vec!["Connection saved on this Mac.".into()];
                self.detail_offset = 0;
            }
            Err(error) => {
                if let Some(form) = &mut self.form {
                    form.error = Some(error);
                }
            }
        }
    }

    fn lines(&self, width: usize, height: usize) -> Vec<String> {
        let content_width = width.saturating_sub(4).clamp(1, 76);
        let lines = if width < 40 || height < 12 {
            vec![
                "Enlarge terminal to 40 columns / 12 rows.".into(),
                if self.form.is_some() {
                    "Esc cancels this form."
                } else {
                    "q or Esc quits."
                }
                .into(),
            ]
        } else if self.details_open {
            let paragraphs = wrap(&self.details, content_width);
            let room = height.saturating_sub(8).max(1);
            let offset = self.detail_offset.min(paragraphs.len().saturating_sub(1));
            let mut lines = vec![
                "Setup progress".into(),
                self.hosts
                    .get(self.selected)
                    .map(|host| host.name.clone())
                    .unwrap_or_default(),
                String::new(),
            ];
            lines.extend(paragraphs.iter().skip(offset).take(room).cloned());
            lines.push(String::new());
            lines.extend(ui::help_lines(
                &footer(
                    "Back to setup",
                    if paragraphs.len() > room {
                        "↑/↓ read · Esc back"
                    } else {
                        "Esc back"
                    },
                ),
                content_width,
            ));
            lines
        } else if let Some(form) = &self.form {
            if let Some(error) = &form.error {
                let mut lines = vec!["Connection profile not saved".into(), String::new()];
                lines.extend(wrap(
                    &[error.to_string(), format!("Next: {}", error.next_action())],
                    content_width,
                ));
                lines.extend(ui::help_lines(
                    &footer("Edit connection", "Esc back"),
                    content_width,
                ));
                return lines;
            }
            let mut lines = vec![
                "Add a host connection".into(),
                "Saved on this Mac".into(),
                String::new(),
            ];
            for (index, label) in [
                "Profile name",
                "SSH address or alias",
                "Administrator login",
            ]
            .iter()
            .enumerate()
            {
                let prefix = format!(
                    "{} {label}: ",
                    if index == form.selected { ">" } else { " " }
                );
                let room = content_width.saturating_sub(prefix.len());
                let value = &form.values[index];
                // Show the editing end of long, ASCII-only connection fields.
                let start = value.len().saturating_sub(room);
                lines.push(format!("{prefix}{}", &value[start..]));
            }
            lines.extend([
                String::new(),
                format!(
                    "{} Save connection profile",
                    if form.selected == 3 { ">" } else { " " }
                ),
            ]);
            lines.extend(ui::help_lines(
                &footer(
                    if form.selected == 3 {
                        "Save connection"
                    } else {
                        "Next field"
                    },
                    "↑/↓ field · Esc back",
                ),
                content_width,
            ));
            lines
        } else {
            let help = if self.hosts.is_empty() {
                "Enter: Add Mac · q Quit"
            } else {
                "Enter: Set up · ↑/↓ Select · n Add Mac · q Quit"
            };
            let help = crate::ui::help_lines(help, content_width);
            let count = ((height.saturating_sub(help.len() + 5)) / 2).clamp(1, 8);
            let start = self
                .selected
                .saturating_sub(count - 1)
                .min(self.hosts.len().saturating_sub(count));
            let end = (start + count).min(self.hosts.len());
            let mut lines = vec![
                "Homelab setup".into(),
                if self.hosts.is_empty() {
                    "Add the Mac you want to set up".into()
                } else {
                    format!(
                        "Saved connections {}–{end} of {}",
                        start + 1,
                        self.hosts.len()
                    )
                },
            ];
            for index in start..end {
                let host = &self.hosts[index];
                let prefix = if index == self.selected { ">" } else { " " };
                let combined = format!("{prefix} {} · {}", host.name, host.address);
                if combined.chars().count() <= content_width {
                    lines.push(combined);
                } else {
                    lines.push(format!("{prefix} {}", host.name));
                    if index == self.selected {
                        let address = wrap(std::slice::from_ref(&host.address), content_width);
                        for (row, line) in address.iter().take(2).enumerate() {
                            if row == 1 && address.len() > 2 {
                                lines.push(format!(
                                    "{}…",
                                    line.chars().take(content_width - 1).collect::<String>()
                                ));
                            } else {
                                lines.push(line.clone());
                            }
                        }
                    }
                }
            }
            if let Some(message) = self.details.first() {
                let room = height.saturating_sub(lines.len() + help.len() + 2);
                lines.extend(
                    wrap(std::slice::from_ref(message), content_width)
                        .into_iter()
                        .take(room.min(1)),
                );
            }
            lines.push(String::new());
            lines.extend(help);
            lines
        };
        lines
            .into_iter()
            .take(height.saturating_sub(1))
            .map(|line| line.chars().take(content_width).collect())
            .collect()
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

pub(crate) fn write_styled(
    output: &mut impl Write,
    text: &str,
    heading: bool,
    help: bool,
) -> io::Result<()> {
    let role = if heading {
        Role::Heading
    } else if text.starts_with("> ") {
        Role::Selected
    } else if text.starts_with("Enter:") {
        Role::Action
    } else if text.starts_with("! ") {
        Role::Warning
    } else if help {
        Role::Help
    } else {
        return ui::paint_fact(output, text);
    };
    ui::paint(output, text, role)
}

#[derive(Debug, Error)]
pub enum MenuError {
    #[error("{0}")]
    Inventory(#[from] InventoryError),
    #[error("The terminal menu could not continue.")]
    Terminal,
}

/// Open the menu. Merely opening it never connects to a host.
pub fn launch(path: &Path) -> Result<(), MenuError> {
    let hosts = match inventory::load(path) {
        Ok(hosts) => hosts,
        Err(InventoryError::Missing) => Vec::new(),
        Err(error) => return Err(error.into()),
    };
    let mut menu = Menu::new(hosts);
    let result = run_menu(path, &mut menu);
    result.map_err(|_| MenuError::Terminal)
}

fn render_menu(menu: &Menu, width: u16, height: u16) -> io::Result<()> {
    let mut output = io::stdout();
    queue!(output, MoveTo(0, 0), Clear(ClearType::All))?;
    let lines = menu.lines(width.into(), height.into());
    for (row, line) in lines.iter().enumerate() {
        let help = width >= 40 && height >= 12 && row >= lines.len().saturating_sub(2);
        queue!(output, MoveTo(2, row as u16 + 1))?;
        if row == 1 {
            ui::paint(&mut output, line, Role::Context)?;
        } else {
            write_styled(&mut output, line, row == 0, help)?;
        }
    }
    output.flush()
}

fn run_menu(path: &Path, menu: &mut Menu) -> io::Result<()> {
    let mut terminal_guard = Some(Terminal::enter()?);
    loop {
        let (width, height) = terminal::size()?;
        let width = width.min(80);
        render_menu(menu, width, height)?;
        if !event::poll(Duration::from_millis(100))? {
            continue;
        }
        let Event::Key(key) = event::read()? else {
            continue;
        };
        match menu.key(key, width.into()) {
            Action::None => {}
            Action::Quit => return Ok(()),
            Action::Save(host) => menu.save(path, host),
            Action::Setup(host) => {
                drop(terminal_guard.take());
                menu.details = crate::setup_wizard::launch(&host, path)?.lines;
                menu.hosts = inventory::load(path)
                    .map_err(|_| io::Error::other("Updated inventory could not be reloaded"))?;
                menu.selected = menu
                    .hosts
                    .iter()
                    .position(|profile| profile.name == host.name)
                    .unwrap_or_else(|| menu.selected.min(menu.hosts.len().saturating_sub(1)));
                menu.detail_offset = 0;
                menu.details_open = !menu.details.is_empty();
                terminal_guard = Some(Terminal::enter()?);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "interactive synthetic preview, not a host operation"]
    fn render_preview() {
        let mut menu = Menu::new(vec![HostProfile {
            name: "build-mac".into(),
            address: "build-mac.local".into(),
            user: "admin".into(),
            identity: None,
            configuration_host: None,
        }]);
        if std::env::var("HOMELAB_PREVIEW").as_deref() == Ok("add") {
            menu.form = Some(Form::default());
        }
        let _terminal = Terminal::enter().unwrap();
        let (width, height) = terminal::size().unwrap();
        render_menu(&menu, width, height).unwrap();
        while !matches!(event::read().unwrap(), Event::Key(_)) {}
    }

    fn menu() -> Menu {
        Menu::new(
            (0..32)
                .map(|index| HostProfile {
                    name: format!("host-{index}"),
                    address: "example-host".into(),
                    user: "operator".into(),
                    identity: None,
                    configuration_host: None,
                })
                .collect(),
        )
    }

    fn press(menu: &mut Menu, code: KeyCode) -> Action {
        menu.key(KeyEvent::new(code, KeyModifiers::NONE), 40)
    }

    #[test]
    fn last_host_and_help_remain_visible_after_resize() {
        let mut menu = menu();
        menu.selected = 31;
        menu.details = vec!["Check complete".into()];
        for (width, height) in [(40, 12), (60, 24), (40, 12)] {
            let lines = menu.lines(width, height);
            assert!(lines.iter().any(|line| line.starts_with("> host-31")));
            assert!(lines.iter().any(|line| line == "Check complete"));
            assert!(lines.iter().any(|line| line.contains("q Quit")));
            assert!(lines.len() < height);
            assert!(lines.iter().all(|line| line.chars().count() < width));
        }
        assert!(menu.lines(30, 8)[0].starts_with("Enlarge terminal"));
    }

    #[test]
    fn add_form_can_cancel_or_produce_a_profile() {
        let mut menu = Menu::new(Vec::new());
        press(&mut menu, KeyCode::Char('n'));
        press(&mut menu, KeyCode::Char('x'));
        press(&mut menu, KeyCode::Esc);
        assert!(menu.form.is_none());
        assert!(menu.hosts.is_empty());
        press(&mut menu, KeyCode::Char('n'));
        for value in ["example", "host", "operator"] {
            for character in value.chars() {
                press(&mut menu, KeyCode::Char(character));
            }
            press(&mut menu, KeyCode::Enter);
        }
        let Action::Save(host) = press(&mut menu, KeyCode::Enter) else {
            panic!("expected save");
        };
        assert_eq!(
            (
                host.name.as_str(),
                host.address.as_str(),
                host.user.as_str()
            ),
            ("example", "host", "operator")
        );
        assert!(menu.hosts.is_empty());
    }

    #[test]
    fn enter_starts_setup_without_a_separate_status_action() {
        let mut menu = menu();
        assert!(matches!(press(&mut menu, KeyCode::Enter), Action::Setup(_)));
        assert!(matches!(press(&mut menu, KeyCode::Char('i')), Action::None));
        assert!(!menu.lines(80, 24).join("\n").contains("Check status"));
        let mut empty = Menu::new(Vec::new());
        press(&mut empty, KeyCode::Enter);
        assert!(empty.form.is_some());
    }

    #[test]
    fn details_scroll_and_long_words_wrap_without_loss() {
        let mut menu = menu();
        menu.details = (0..20).map(|index| format!("Detail {index}")).collect();
        menu.details_open = true;
        assert!(menu.lines(40, 12).iter().any(|line| line == "Detail 0"));
        press(&mut menu, KeyCode::Down);
        assert!(menu.lines(40, 12).iter().any(|line| line == "Detail 1"));
        press(&mut menu, KeyCode::PageUp);
        assert_eq!(menu.detail_offset, 0);
        let word = "x".repeat(253);
        assert_eq!(wrap(std::slice::from_ref(&word), 38).concat(), word);
    }

    #[test]
    fn every_detail_is_reachable_at_the_minimum_terminal_size() {
        let mut menu = menu();
        menu.details = (0..20).map(|index| format!("Detail {index}")).collect();
        let mut seen = std::collections::BTreeSet::new();
        menu.details_open = true;
        for _ in 0..20 {
            seen.extend(menu.lines(40, 12));
            press(&mut menu, KeyCode::Down);
        }
        assert!(menu.details.iter().all(|detail| seen.contains(detail)));
        assert_eq!(
            menu.selected, 0,
            "reading must not change the selected host"
        );
        assert!(!menu.lines(40, 12).join("\n").contains("PgUp"));
        press(&mut menu, KeyCode::Esc);
        assert!(!menu.details_open);
        assert!(matches!(press(&mut menu, KeyCode::Enter), Action::Setup(_)));
    }

    #[test]
    fn changing_hosts_does_not_attribute_the_previous_result_to_the_new_host() {
        let mut menu = menu();
        menu.details = vec!["Previous host result".into()];
        press(&mut menu, KeyCode::Down);
        menu.details_open = true;
        assert!(
            !menu
                .lines(80, 24)
                .join("\n")
                .contains("Previous host result")
        );
        assert!(menu.lines(80, 24).iter().any(|line| line == "host-1"));
    }

    #[test]
    fn scrolling_back_from_the_end_moves_immediately() {
        let mut menu = menu();
        menu.details = (0..20).map(|index| format!("Detail {index}")).collect();
        menu.details_open = true;
        for _ in 0..30 {
            press(&mut menu, KeyCode::Down);
        }
        assert_eq!(menu.detail_offset, 19);
        press(&mut menu, KeyCode::PageUp);
        assert_eq!(menu.detail_offset, 18);
        assert!(menu.lines(40, 12).iter().any(|line| line == "Detail 18"));
    }

    #[test]
    fn small_terminal_help_matches_the_current_screen() {
        let mut menu = menu();
        assert_eq!(menu.lines(35, 8)[1], "q or Esc quits.");
        press(&mut menu, KeyCode::Char('n'));
        assert_eq!(menu.lines(35, 8)[1], "Esc cancels this form.");
        press(&mut menu, KeyCode::Esc);
        assert_eq!(menu.lines(35, 8)[1], "q or Esc quits.");
    }

    #[test]
    fn failed_save_keeps_values_and_can_be_corrected_and_retried() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("private/inventory.json");
        let host = HostProfile {
            name: "example".into(),
            address: "host".into(),
            user: "operator".into(),
            identity: None,
            configuration_host: None,
        };
        let mut menu = Menu::new(inventory::add(&path, host).unwrap());
        let before = std::fs::read(&path).unwrap();
        press(&mut menu, KeyCode::Char('n'));
        for value in ["example", "host", "operator"] {
            for character in value.chars() {
                press(&mut menu, KeyCode::Char(character));
            }
            press(&mut menu, KeyCode::Enter);
        }
        let Action::Save(host) = press(&mut menu, KeyCode::Enter) else {
            panic!("expected save");
        };
        menu.save(&path, host);
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert_eq!(
            menu.form.as_ref().unwrap().values,
            ["example", "host", "operator"]
        );
        let error_lines = menu.lines(40, 12).join(" ");
        assert!(error_lines.contains("already exists"));
        assert!(error_lines.contains("Choose a unique profile name"));
        assert!(error_lines.contains("Enter: Edit connection"));

        press(&mut menu, KeyCode::Enter);
        for _ in 0..3 {
            press(&mut menu, KeyCode::Up);
        }
        press(&mut menu, KeyCode::Char('2'));
        for _ in 0..3 {
            press(&mut menu, KeyCode::Down);
        }
        let Action::Save(host) = press(&mut menu, KeyCode::Enter) else {
            panic!("expected retry");
        };
        menu.save(&path, host);
        assert!(menu.form.is_none());
        assert_eq!(menu.hosts[menu.selected].name, "example2");
        assert_eq!(inventory::load(&path).unwrap().len(), 2);
    }

    #[test]
    fn save_errors_and_recovery_help_fit_the_minimum_terminal() {
        let mut menu = menu();
        for error in [
            InventoryError::Missing,
            InventoryError::Invalid,
            InventoryError::TooLarge,
            InventoryError::DuplicateName,
            InventoryError::Full,
            InventoryError::ReadFailed,
            InventoryError::UnsafeLocation,
            InventoryError::Busy,
            InventoryError::SaveFailed,
        ] {
            menu.form = Some(Form {
                error: Some(error),
                ..Form::default()
            });
            let lines = menu.lines(40, 12);
            assert!(lines.len() < 12, "{lines:?}");
            assert!(lines.iter().all(|line| line.len() < 40));
            assert!(lines.last().unwrap().ends_with("Esc back"));
        }
    }

    #[test]
    fn control_c_quits_or_cancels_form() {
        let mut menu = menu();
        let key = KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
        assert!(matches!(menu.key(key, 40), Action::Quit));
        press(&mut menu, KeyCode::Char('n'));
        assert!(matches!(menu.key(key, 40), Action::None));
        assert!(menu.form.is_none());
    }
}
