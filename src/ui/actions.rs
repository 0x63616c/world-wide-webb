//! Footer actions are shared with input handling; status text belongs in the body.
use crossterm::event::KeyCode;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Action {
    Primary(String),
    Navigation,
    Back,
    Help,
    Details,
    Clear,
    Quit,
    ConfirmQuit,
    Interrupt,
    Submit,
    OpenPr,
    Retry,
    StopAfterStep,
    SaveAndExit,
    StopBeforeInstallation,
    Screens,
    ScreenPosition(usize, usize),
    Next,
    Exit,
}

impl Action {
    pub(crate) fn label(&self) -> String {
        match self {
            Self::Primary(label) => format!("Enter {label}"),
            Self::Navigation => "↑/↓ Navigation".into(),
            Self::Back => "Esc Back".into(),
            Self::Help => "? Help".into(),
            Self::Details => "i Details".into(),
            Self::Clear => "Ctrl-U Clear".into(),
            Self::Quit => "Ctrl-C Quit".into(),
            Self::ConfirmQuit => "Press Ctrl-C again to quit".into(),
            Self::Interrupt => "Ctrl-C Interrupt".into(),
            Self::Submit => "Enter Submit".into(),
            Self::OpenPr => "O Open PR".into(),
            Self::Retry => "R Retry checks".into(),
            Self::StopAfterStep => "Esc Stop after step".into(),
            Self::SaveAndExit => "Esc Save and exit".into(),
            Self::StopBeforeInstallation => "Esc Stop before installation".into(),
            Self::Screens => "←/→ Screens".into(),
            Self::ScreenPosition(index, total) => format!("←/→ Screens {index}/{total}"),
            Self::Next => "Enter Next".into(),
            Self::Exit => "Esc Exit".into(),
        }
    }

    pub(crate) fn matches(&self, key: KeyCode) -> bool {
        match self {
            Self::Primary(_) | Self::Submit | Self::Next => key == KeyCode::Enter,
            Self::Navigation => matches!(
                key,
                KeyCode::Up | KeyCode::Down | KeyCode::PageUp | KeyCode::PageDown
            ),
            Self::Back
            | Self::StopAfterStep
            | Self::SaveAndExit
            | Self::StopBeforeInstallation
            | Self::Exit => key == KeyCode::Esc,
            Self::Help => key == KeyCode::Char('?'),
            Self::Details => key == KeyCode::Char('i'),
            Self::OpenPr => matches!(key, KeyCode::Char('o' | 'O')),
            Self::Retry => matches!(key, KeyCode::Char('r' | 'R')),
            Self::Screens | Self::ScreenPosition(_, _) => {
                matches!(key, KeyCode::Left | KeyCode::Right)
            }
            // Control-key events are handled before KeyCode reaches a screen.
            Self::Clear => key == KeyCode::Char('\u{15}'),
            Self::Quit | Self::ConfirmQuit | Self::Interrupt => false,
        }
    }
}

pub(crate) fn with_primary(label: &str, actions: &[Action]) -> Vec<Action> {
    let mut result = Vec::new();
    if !label.is_empty() {
        result.push(Action::Primary(label.into()));
    }
    result.extend_from_slice(actions);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn displayed_actions_use_the_same_key_mapping_as_handlers() {
        for (action, key, label) in [
            (Action::Back, KeyCode::Esc, "Esc Back"),
            (Action::Help, KeyCode::Char('?'), "? Help"),
            (Action::Details, KeyCode::Char('i'), "i Details"),
            (
                Action::Primary("Continue".into()),
                KeyCode::Enter,
                "Enter Continue",
            ),
            (Action::Navigation, KeyCode::Down, "↑/↓ Navigation"),
        ] {
            assert!(action.matches(key));
            assert_eq!(action.label(), label);
            assert!(!action.matches(KeyCode::Char('z')));
        }
    }
}
