//! Synthetic presentation fixtures. This module has no setup or provider dependencies.
use crate::ui::actions::Action;
use std::io;

use clap::ValueEnum;
use crossterm::event::KeyCode;

use crate::{setup_wizard, tui, ui};
use ui::Role;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
pub enum Screen {
    RepositoryLoading,
    Connection,
    Trust,
    KeyRequired,
    KeySource,
    KeyPicker,
    KeyReview,
    PublicKey,
    RepositoryError,
    Approval,
    Reboot,
    Saved,
    Hosts,
    Details,
    Summary,
    Progress,
    Authentication,
    Attention,
    Complete,
    #[default]
    Input,
    Help,
}

const SCREENS: [Screen; 21] = [
    Screen::Input,
    Screen::RepositoryLoading,
    Screen::RepositoryError,
    Screen::Hosts,
    Screen::Details,
    Screen::Connection,
    Screen::Trust,
    Screen::KeyRequired,
    Screen::KeySource,
    Screen::KeyPicker,
    Screen::PublicKey,
    Screen::KeyReview,
    Screen::Summary,
    Screen::Progress,
    Screen::Authentication,
    Screen::Approval,
    Screen::Reboot,
    Screen::Attention,
    Screen::Saved,
    Screen::Complete,
    Screen::Help,
];

const FOOTER: &[Action] = &[
    Action::Screens,
    Action::Navigation,
    Action::Next,
    Action::Exit,
];

struct Fixture {
    title: &'static str,
    lines: Vec<(String, Role)>,
}

fn fixture(screen: Screen) -> Fixture {
    if screen == Screen::Authentication {
        return Fixture {
            title: "Setting up your Mac",
            lines: ui::components::password_field("studio-mac", "Password:", 8, false),
        };
    }
    if screen == Screen::Help {
        return Fixture {
            title: "Help",
            lines: ui::help_body(),
        };
    }
    let (title, lines): (_, Vec<(&str, Role)>) = match screen {
        Screen::RepositoryLoading => (
            "Opening homelab",
            vec![
                ("Repo: example/homelab", Role::Repository),
                ("› Reading configuration", Role::Working),
            ],
        ),
        Screen::RepositoryError => (
            "Attachment failed",
            vec![
                (
                    "Could not read the repository configuration.",
                    Role::Warning,
                ),
                ("", Role::Body),
                (
                    "Check owner/name, gh authentication and homelab.json.",
                    Role::Body,
                ),
            ],
        ),
        Screen::Connection => (
            "Connecting to studio-mac",
            vec![
                ("admin@studio-mac.local", Role::Context),
                ("", Role::Body),
                ("✓ Connected over SSH", Role::Success),
                ("", Role::Body),
                ("› Checking Mac", Role::Working),
            ],
        ),
        Screen::Trust => (
            "Trust this Mac?",
            vec![
                ("admin@studio-mac.local", Role::Context),
                ("", Role::Body),
                ("Trust: save the first SSH host key.", Role::Body),
                ("Identity: not independently verified.", Role::Body),
                ("Changed keys: still blocked.", Role::Body),
            ],
        ),
        Screen::KeyRequired => (
            "How do you want to connect?",
            vec![
                ("admin@studio-mac.local", Role::Context),
                ("SSH key not accepted", Role::Warning),
                ("Use the target password to add a key.", Role::Body),
                ("", Role::Body),
                ("> Install public key", Role::Selected),
                ("  Check SSH access", Role::ListOption),
            ],
        ),
        Screen::KeySource => (
            "Where is your SSH key?",
            vec![
                ("Private keys stay on your Mac.", Role::Context),
                ("", Role::Body),
                ("> 1Password SSH agent", Role::Selected),
                ("  Current SSH agent", Role::ListOption),
                ("  Public-key file", Role::ListOption),
            ],
        ),
        Screen::KeyPicker => (
            "Which SSH key do you want to use?",
            vec![
                ("> Personal Mac", Role::Selected),
                (
                    "SHA256:example-personal-key-fingerprint",
                    Role::SelectedDetail,
                ),
                ("", Role::Body),
                ("  Work Mac", Role::ListOption),
                ("SHA256:example-work-key-fingerprint", Role::ListDetail),
            ],
        ),
        Screen::PublicKey => (
            "Which public-key file should we use?",
            vec![
                ("Public-key file (.pub)", Role::Body),
                ("/example/.ssh/id_ed25519.pub", Role::Input),
            ],
        ),
        Screen::KeyReview => (
            "Use this key for this Mac?",
            vec![
                ("admin@studio-mac.local", Role::Context),
                (
                    "Fingerprint: SHA256:example-personal-key-fingerprint",
                    Role::Body,
                ),
                ("", Role::Body),
                ("Remember this public key for this Mac.", Role::Body),
                ("Connect directly using this key.", Role::Body),
                ("", Role::Body),
                (
                    "Check the selected key first. Install only if authentication is denied.",
                    Role::Body,
                ),
                ("", Role::Body),
                (
                    "Existing keys are kept. Your password is never stored.",
                    Role::Body,
                ),
            ],
        ),
        Screen::Approval => (
            "Setting up studio-mac",
            vec![
                ("✓ Prepared", Role::Success),
                ("› Installing", Role::Working),
                ("○ Verify", Role::Pending),
                ("", Role::Body),
                ("Waiting for Git approval", Role::Body),
                ("https://github.com/example/homelab/pull/12", Role::Action),
            ],
        ),
        Screen::Reboot => (
            "Setting up studio-mac",
            vec![
                ("✓ Prepared", Role::Success),
                ("✓ Installed", Role::Success),
                ("› Verifying", Role::Working),
                ("", Role::Body),
                ("Waiting for the Mac to reconnect", Role::Body),
            ],
        ),
        Screen::Saved => (
            "Setup saved",
            vec![
                ("studio-mac", Role::Context),
                ("", Role::Body),
                ("Reopen this host to continue.", Role::Body),
            ],
        ),
        Screen::Hosts => (
            "Which Mac do you want to set up?",
            vec![
                ("Repo: example/homelab", Role::Repository),
                ("", Role::Body),
                ("> studio-mac", Role::Selected),
                ("  lab-mini", Role::ListOption),
                ("", Role::Body),
                ("Resume setup", Role::Hint),
            ],
        ),
        Screen::Details => (
            "About studio-mac",
            vec![
                ("Repo: example/homelab", Role::Repository),
                ("Configuration: studio-mac", Role::Field),
                ("", Role::Body),
                ("SSH: admin@studio-mac.local", Role::Field),
                ("", Role::Body),
                ("Resume setup", Role::Context),
            ],
        ),
        Screen::Summary => (
            "Set up studio-mac?",
            vec![
                ("admin@studio-mac.local · 356 / 512 GB used", Role::Context),
                ("Repo: example/homelab", Role::Repository),
                ("", Role::Body),
                ("Prepare · Back up keys and prepare this Mac.", Role::Body),
                ("", Role::Body),
                (
                    "Install · Save configuration in Git and install it.",
                    Role::Body,
                ),
                ("", Role::Body),
                (
                    "Verify · Restart and check remote access and Git updates.",
                    Role::Body,
                ),
                ("", Role::Body),
                (
                    "FileVault may require a local unlock after restart.",
                    Role::Context,
                ),
            ],
        ),
        Screen::Progress => (
            "Setting up studio-mac",
            vec![
                ("admin@studio-mac.local", Role::Context),
                ("", Role::Body),
                ("› Preparing", Role::Working),
                ("○ Install", Role::Pending),
                ("○ Verify", Role::Pending),
                ("", Role::Body),
                ("Backing up and encrypting keys", Role::Body),
            ],
        ),
        Screen::Authentication => unreachable!("handled above"),
        Screen::Attention => (
            "Setup needs attention",
            vec![
                ("studio-mac · Recovery backup", Role::Context),
                ("", Role::Body),
                ("! 1Password is locked", Role::Warning),
                ("", Role::Body),
                (
                    "Unlock 1Password and approve access when prompted.",
                    Role::Body,
                ),
                (
                    "Your progress is saved. Retry continues from this step.",
                    Role::Context,
                ),
                ("", Role::Body),
                ("> Retry", Role::Selected),
                ("  Return to hosts", Role::ListOption),
            ],
        ),
        Screen::Complete => (
            "studio-mac is ready",
            vec![
                ("example/homelab", Role::Context),
                ("", Role::Body),
                ("✓ Configuration installed", Role::Success),
                ("✓ Restart and remote access verified", Role::Success),
                ("✓ Automatic Git updates verified", Role::Success),
                ("", Role::Body),
                (
                    "Manage this Mac by updating your configuration repository.",
                    Role::Body,
                ),
            ],
        ),
        Screen::Input => (
            "Which repo do you want to use?",
            vec![("owner/repo", Role::Placeholder)],
        ),
        Screen::Help => unreachable!("help uses the shared production content"),
    };
    Fixture {
        title,
        lines: lines
            .into_iter()
            .map(|(line, role)| (line.into(), role))
            .collect(),
    }
}

fn select_choice(fixture: &mut Fixture, choice: usize) -> usize {
    let mut count = 0;
    let mut selected = false;
    for (_, role) in &mut fixture.lines {
        if matches!(role, Role::Selected | Role::ListOption) {
            selected = count == choice;
            *role = if selected {
                Role::Selected
            } else {
                Role::ListOption
            };
            count += 1;
        } else if matches!(role, Role::SelectedDetail | Role::ListDetail) {
            *role = if selected {
                Role::SelectedDetail
            } else {
                Role::ListDetail
            };
        }
    }
    if fixture.title == "Which Mac do you want to set up?"
        && count > 0
        && let Some((text, _)) = fixture.lines.last_mut()
    {
        *text = if choice == 0 {
            "Resume setup"
        } else {
            "Not set up"
        }
        .into();
    }
    count
}

fn fit_fixture(fixture: &mut Fixture, height: u16) {
    if height < 18 {
        fixture.lines.retain(|(text, role)| {
            !text.is_empty() && !matches!(role, Role::ListOption | Role::ListDetail)
        });
    }
}

/// Preview uses the production renderer, but cannot start setup or read operator state.
pub fn launch(screen: Screen) -> io::Result<()> {
    let _terminal = tui::Terminal::enter()?;
    let mut selected = SCREENS.iter().position(|item| *item == screen).unwrap_or(0);
    let mut offset = 0;
    let mut choice = 0;
    loop {
        let mut fixture = fixture(SCREENS[selected]);
        let choices = select_choice(&mut fixture, choice);
        fit_fixture(&mut fixture, crossterm::terminal::size()?.1);
        let title = fixture.title;
        let footer = [
            Action::ScreenPosition(selected + 1, SCREENS.len()),
            Action::Navigation,
            Action::Next,
            Action::Exit,
        ];
        let last = if choices > 0 {
            ui::render_selected(title, &fixture.lines, &footer)?
        } else {
            ui::render(title, &fixture.lines, offset, &footer)?
        };
        offset = offset.min(last);
        if !crossterm::event::poll(std::time::Duration::from_millis(80))? {
            continue;
        }
        match setup_wizard::key()? {
            KeyCode::Right | KeyCode::Enter => {
                selected = (selected + 1) % SCREENS.len();
                offset = 0;
                choice = 0;
            }
            KeyCode::Left => {
                selected = (selected + SCREENS.len() - 1) % SCREENS.len();
                offset = 0;
                choice = 0;
            }
            KeyCode::Up if choices > 0 => choice = choice.saturating_sub(1),
            KeyCode::Down if choices > 0 => choice = (choice + 1).min(choices - 1),
            KeyCode::Up => offset = offset.saturating_sub(1),
            KeyCode::Down => offset = (offset + 1).min(last),
            KeyCode::Esc | KeyCode::Char('q') => return Ok(()),
            _ => (),
        }
    }
}

/// Render a bounded plain-text artifact without touching terminal state or services.
pub fn dump(screen: Screen, width: u16, height: u16) -> io::Result<String> {
    if !(1..=300).contains(&width) || !(1..=120).contains(&height) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "preview size is out of bounds",
        ));
    }
    let backend = ratatui::backend::TestBackend::new(width, height);
    let mut terminal = ratatui::Terminal::new(backend)?;
    let mut fixture = fixture(screen);
    select_choice(&mut fixture, 0);
    fit_fixture(&mut fixture, height);
    terminal.draw(|frame| {
        ui::render_frame(frame, fixture.title, &fixture.lines, 0, FOOTER, false, None);
    })?;
    let buffer = terminal.backend().buffer();
    Ok((0..height)
        .map(|row| {
            (0..width)
                .map(|column| buffer[(column, row)].symbol())
                .collect::<String>()
                .trim_end()
                .to_owned()
        })
        .collect::<Vec<_>>()
        .join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_selection_moves_the_item_and_its_supporting_text() {
        let mut keys = fixture(Screen::KeyPicker);
        assert_eq!(select_choice(&mut keys, 1), 2);
        let selected = keys
            .lines
            .iter()
            .filter(|(_, role)| *role == Role::Selected)
            .collect::<Vec<_>>();
        assert_eq!(selected.len(), 1);
        assert!(selected[0].0.contains("Work Mac"));
        let detail = keys
            .lines
            .iter()
            .find(|(_, role)| *role == Role::SelectedDetail)
            .unwrap();
        assert!(detail.0.contains("work-key"));
        assert_eq!(fixture(Screen::Help).lines, ui::help_body());
    }

    #[test]
    fn every_preview_is_synthetic_and_has_content() {
        for screen in SCREENS {
            let fixture = fixture(screen);
            assert!(!fixture.title.is_empty());
            assert!(!fixture.lines.is_empty());
            for (line, _) in fixture.lines {
                assert!(!line.contains("tskey-"));
                assert!(!line.contains("AGE-SECRET-KEY"));
                assert!(!line.contains("/Users/"));
            }
        }
    }

    #[test]
    fn all_screens_render_with_shared_header_and_footer_at_supported_sizes() {
        for screen in SCREENS {
            for (width, height) in [(40, 12), (80, 24), (160, 48)] {
                let text = dump(screen, width, height).unwrap();
                assert!(text.contains("[~] homelab"));
                assert!(text.contains("Esc Exit"));
                assert_eq!(text.lines().count(), usize::from(height));
            }
        }
        assert!(
            dump(Screen::Hosts, 20, 8)
                .unwrap()
                .contains("Enlarge terminal")
        );
    }
}
