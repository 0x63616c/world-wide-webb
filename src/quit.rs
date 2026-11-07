//! Confirmation is shared by screens; setup still stops only at safe checkpoints.
use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use std::cell::Cell;

#[derive(Clone, Copy, Default)]
struct State {
    armed: bool,
    requested: bool,
}
thread_local! { static STATE: Cell<State> = Cell::new(State::default()); }

pub(crate) fn reset() {
    STATE.set(State::default());
}
pub(crate) fn armed() -> bool {
    STATE.get().armed
}
pub(crate) fn requested() -> bool {
    STATE.get().requested
}

fn transition(state: &mut State, key: KeyEvent) -> KeyCode {
    if key.kind != KeyEventKind::Press {
        return KeyCode::Null;
    }
    if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
        if state.armed {
            state.requested = true;
            state.armed = false;
            return KeyCode::Esc;
        }
        state.armed = true;
        return KeyCode::Null;
    }
    if state.armed {
        state.armed = false;
        return KeyCode::Null;
    }
    key.code
}

pub(crate) fn handle(key: KeyEvent) -> KeyCode {
    STATE.with(|cell| {
        let mut state = cell.get();
        let code = transition(&mut state, key);
        cell.set(state);
        code
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn two_ctrl_c_presses_confirm_but_other_keys_cancel_without_acting() {
        let ctrl_c = KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
        let mut state = State::default();
        assert_eq!(transition(&mut state, ctrl_c), KeyCode::Null);
        assert!(state.armed && !state.requested);
        assert_eq!(
            transition(
                &mut state,
                KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)
            ),
            KeyCode::Null
        );
        assert!(!state.armed && !state.requested);
        transition(&mut state, ctrl_c);
        assert_eq!(transition(&mut state, ctrl_c), KeyCode::Esc);
        assert!(state.requested);
    }
}
