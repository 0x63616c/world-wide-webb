//! Presentation only: durable journals, not these rows, decide what can resume.
use crate::ui::actions::Action;
use std::io;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::terminal;

use crate::ui::Role;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Step {
    Tools,
    Identity,
    Credentials,
    Configuration,
    Install,
    Verify,
    Updates,
}
const STEPS: [Step; 7] = [
    Step::Tools,
    Step::Identity,
    Step::Credentials,
    Step::Configuration,
    Step::Install,
    Step::Verify,
    Step::Updates,
];
impl Step {
    fn index(self) -> usize {
        STEPS.iter().position(|step| *step == self).unwrap()
    }
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Tools => "Developer tools",
            Self::Identity => "Repository access",
            Self::Credentials => "Recovery and secrets",
            Self::Configuration => "Git configuration",
            Self::Install => "Mac configuration",
            Self::Verify => "Startup and connectivity",
            Self::Updates => "Automatic updates",
        }
    }
    fn explanation(self) -> &'static str {
        match self {
            Self::Tools => {
                "Use working developer tools or install Apple's Command Line Tools. Administrator authentication stays inside setup."
            }
            Self::Identity => {
                "Reconcile the target-local read-only Git identity. Private Git keys stay on the target."
            }
            Self::Credentials => {
                "Verify recovery backups in 1Password before issuing and encrypting enrollment credentials. Uncertain issuance stops for inspection."
            }
            Self::Configuration => {
                "Publish only the reviewed enrollment changes. Repository policy may require a pull request instead of a direct commit."
            }
            Self::Install => {
                "Install the exact approved revision. SSH and sudo handle embedded password prompts; an uncertain activation is never blindly repeated."
            }
            Self::Verify => {
                "Verify services, remote access and reboot. FileVault may need local unlock."
            }
            Self::Updates => "Release the setup hold and let Comin build and apply Git main.",
        }
    }
}
use crate::ui::components::ProgressState as State;
pub(super) struct Checklist {
    host: String,
    states: [State; 7],
    current: Step,
    started: Instant,
    message: String,
    details: bool,
    offset: usize,
    last_offset: usize,
    link: Option<String>,
    pub(super) cancelled: bool,
}
impl Checklist {
    pub(super) fn new(host: &str) -> Self {
        Self::new_at(host, Instant::now())
    }

    fn new_at(host: &str, now: Instant) -> Self {
        Self {
            host: host.into(),
            states: [State::Pending; 7],
            current: Step::Tools,
            started: now,
            message: String::new(),
            details: false,
            offset: 0,
            last_offset: 0,
            link: None,
            cancelled: false,
        }
    }
    pub(super) fn begin(&mut self, step: Step, message: &str) {
        self.begin_at(step, message, Instant::now());
    }

    fn begin_at(&mut self, step: Step, message: &str, now: Instant) {
        if self.current != step || self.states[step.index()] != State::Running {
            self.started = now;
            self.offset = 0;
        }
        self.current = step;
        self.states[step.index()] = State::Running;
        self.message = message.into();
    }
    pub(super) fn done(&mut self, step: Step) {
        self.states[step.index()] = State::Complete;
    }
    pub(super) fn rows(&self) -> Vec<(String, Role)> {
        self.stages()
            .into_iter()
            .map(|(label, state)| state.row(label))
            .collect()
    }
    fn fail(&mut self, step: Step, message: String) {
        self.states[step.index()] = State::Failed;
        self.message = message;
    }

    fn stages(&self) -> [(&'static str, State); 7] {
        STEPS.map(|step| (step.label(), self.states[step.index()]))
    }

    pub(super) fn message(&mut self, message: &str) {
        self.message = message.into();
    }
    fn body(&self, height: usize) -> Vec<(String, Role)> {
        self.body_at(height, Instant::now())
    }

    fn body_at(&self, height: usize, now: Instant) -> Vec<(String, Role)> {
        let elapsed = now.saturating_duration_since(self.started);
        if height < 18 && self.states[self.current.index()] == State::Failed && !self.details {
            return vec![
                (String::new(), Role::Body),
                (self.message.clone(), Role::Warning),
            ];
        }
        let mut body = vec![(
            format!("{} · {}s", self.host, elapsed.as_secs()),
            Role::Context,
        )];
        body.push((String::new(), Role::Body));
        if self.details {
            body.push((self.current.label().into(), Role::Section));
            body.push((self.current.explanation().into(), Role::Body));
            body.push((String::new(), Role::Body));
            body.push((
                if self.stopping() {
                    "Stopping after this step; progress stays saved.".into()
                } else {
                    self.message.clone()
                },
                Role::Body,
            ));
            return body;
        }
        for (step, (label, state)) in STEPS.into_iter().zip(self.stages()) {
            if height >= 18 || step == self.current {
                body.push(state.row(label));
            }
        }
        body.push((String::new(), Role::Body));
        if self.link.is_some() {
            body.push(("Open enrollment PR".into(), Role::Action));
        }
        body.push((
            if self.stopping() {
                "Stopping after this step; progress stays saved.".into()
            } else {
                self.message.clone()
            },
            Role::Body,
        ));
        body
    }
    fn stopping(&self) -> bool {
        self.cancelled || crate::quit::requested()
    }

    fn actions(&self, actions: &[Action]) -> Vec<Action> {
        let mut result = Vec::new();
        for action in actions {
            let action = if self.stopping()
                && matches!(
                    action,
                    Action::StopAfterStep
                        | Action::StopBeforeInstallation
                        | Action::SaveAndExit
                        | Action::Quit
                ) {
                Action::Stopping
            } else {
                action.clone()
            };
            if !result.contains(&action) {
                result.push(action);
            }
        }
        if self.stopping() && !result.contains(&Action::Stopping) {
            result.push(Action::Stopping);
        }
        result
    }

    pub(super) fn draw(&mut self, actions: &[Action]) -> io::Result<()> {
        let (_, height) = terminal::size()?;
        self.last_offset = super::render_with_link(
            "Setting up your Mac",
            &self.body(usize::from(height)),
            self.offset,
            &self.actions(actions),
            self.link.as_deref(),
        )?;
        self.offset = self.offset.min(self.last_offset);
        Ok(())
    }
    pub(super) fn key(&mut self, key: KeyCode) {
        match key {
            KeyCode::Char('?' | 'd' | 'D') => {
                self.details = !self.details;
                self.offset = 0;
            }
            KeyCode::Up => self.offset = self.offset.saturating_sub(1),
            KeyCode::Down => self.offset = (self.offset + 1).min(self.last_offset),
            code if Action::Back.matches(code) => self.cancelled = true,
            KeyCode::Char('o' | 'O') => {
                if let Some(url) = &self.link {
                    let mut command = std::process::Command::new("/usr/bin/open");
                    command.arg(url).stdin(std::process::Stdio::null());
                    let _ = crate::process::run_silent(&mut command, Duration::from_secs(5));
                }
            }
            _ => (),
        }
    }
    pub(super) fn pull_request(&mut self, repository: &str, number: u64, url: &str) -> bool {
        let expected = format!("https://github.com/{repository}/pull/{number}");
        if !crate::config::valid_repository(repository) || number == 0 || url != expected {
            return false;
        }
        self.link = Some(expected);
        true
    }
    pub(super) fn clear_link(&mut self) {
        self.link = None;
    }
    pub(super) fn stop_requested(&mut self) -> io::Result<bool> {
        while event::poll(Duration::from_millis(1))? {
            if let Event::Key(key) = event::read()?
                && key.kind != KeyEventKind::Release
            {
                self.key(crate::quit::handle(key));
            }
        }
        Ok(self.cancelled)
    }
    /// Run preparation once without blocking presentation or offering mutation retries.
    pub(super) fn background<T: Send>(
        &mut self,
        operation: impl FnOnce() -> T + Send,
    ) -> io::Result<T> {
        let result = crate::ui::loading::run(|| self.draw(&[Action::Quit]), operation)?;
        self.cancelled |= crate::quit::requested();
        Ok(result)
    }

    /// Keep input and the clock responsive while existing noninteractive operations run.
    /// Cancellation waits for the operation to finish; it never kills a mutation.
    pub(super) fn run<T: Send, E: std::fmt::Display + Send>(
        &mut self,
        step: Step,
        mut operation: impl FnMut(&dyn Fn(&str)) -> Result<T, E> + Send,
    ) -> io::Result<Result<T, E>> {
        loop {
            self.begin(step, "Working…");
            let result = std::thread::scope(|scope| -> io::Result<Result<T, E>> {
                let (messages, updates) = mpsc::channel();
                let operation = &mut operation;
                let worker = scope.spawn(move || {
                    operation(&|message| {
                        let _ = messages.send(message.to_owned());
                    })
                });
                let ui_result = (|| -> io::Result<()> {
                    let mut redraw = Instant::now() - Duration::from_secs(1);
                    while !worker.is_finished() {
                        while let Ok(message) = updates.try_recv() {
                            self.message(&message);
                            redraw = Instant::now() - Duration::from_secs(1);
                        }
                        if redraw.elapsed() >= Duration::from_millis(80) {
                            self.draw(if self.link.is_some() {
                                &[
                                    Action::OpenPr,
                                    Action::Help,
                                    Action::Navigation,
                                    Action::StopAfterStep,
                                ]
                            } else {
                                &[Action::Help, Action::Navigation, Action::StopAfterStep]
                            })?;
                            redraw = Instant::now();
                        }
                        if event::poll(Duration::from_millis(100))?
                            && let Event::Key(key) = event::read()?
                            && key.kind != KeyEventKind::Release
                        {
                            self.key(crate::quit::handle(key));
                            redraw = Instant::now() - Duration::from_secs(1);
                        }
                    }
                    Ok(())
                })();
                // Always join, including terminal failures: losing the screen cannot
                // detach a mutation or start a replacement operation.
                let result = worker
                    .join()
                    .map_err(|_| io::Error::other("Setup worker stopped; preserve saved state"))?;
                ui_result?;
                Ok(result)
            })?;
            match result {
                Ok(value) => return Ok(Ok(value)),
                Err(error) => {
                    self.fail(step, error.to_string());
                    if self.stopping() {
                        self.cancelled = true;
                        return Ok(Err(error));
                    }
                    loop {
                        self.draw(&[
                            Action::Primary("Return".into()),
                            Action::Retry,
                            Action::Help,
                            Action::Navigation,
                            Action::SaveAndExit,
                        ])?;
                        match super::key()? {
                            KeyCode::Char('r' | 'R') => break,
                            code if code == KeyCode::Enter || Action::Back.matches(code) => {
                                self.cancelled = true;
                                return Ok(Err(error));
                            }
                            key => self.key(key),
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stopping_footer_does_not_offer_another_stop() {
        let mut checklist = Checklist::new("example");
        checklist.begin(Step::Credentials, "Waiting for 1Password");
        checklist.key(KeyCode::Esc);
        let actions = checklist.actions(&[Action::Help, Action::StopAfterStep]);
        assert!(actions.contains(&Action::Stopping));
        assert!(!actions.contains(&Action::StopAfterStep));
        assert!(!Action::Stopping.matches(KeyCode::Esc));
        checklist.key(KeyCode::Esc);
        assert!(checklist.cancelled);
    }

    #[test]
    fn confirmed_background_stop_is_visible_before_worker_finishes() {
        use crossterm::event::{KeyEvent, KeyModifiers};
        crate::quit::reset();
        let mut checklist = Checklist::new("example");
        checklist.begin(Step::Credentials, "Waiting for 1Password");
        let key = KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
        crate::quit::handle(key);
        crate::quit::handle(key);
        assert!(!checklist.cancelled);
        assert_eq!(checklist.actions(&[Action::Quit]), vec![Action::Stopping]);
        assert!(
            checklist
                .body(12)
                .iter()
                .any(|(text, _)| text.starts_with("Stopping after"))
        );
        crate::quit::reset();
    }

    #[test]
    fn failed_message_is_separated_even_in_a_small_window() {
        let mut checklist = Checklist::new("example");
        checklist.begin(Step::Credentials, "Reading 1Password");
        checklist.fail(Step::Credentials, "Unlock 1Password and retry.".into());
        let body = checklist.body(12);
        let message = body
            .iter()
            .position(|(line, _)| line.contains("Unlock 1Password"))
            .unwrap();
        assert!(body[message - 1].0.is_empty());
    }

    #[test]
    fn denial_and_return_remain_visible_at_minimum_size() {
        let mut checklist = Checklist::new("fixture-mac");
        checklist.begin(Step::Credentials, "Reading 1Password");
        checklist.fail(
            Step::Credentials,
            crate::secret_store::Error::Access.to_string(),
        );
        let mut terminal =
            ratatui::Terminal::new(ratatui::backend::TestBackend::new(40, 12)).unwrap();
        terminal
            .draw(|frame| {
                crate::ui::render_frame(
                    frame,
                    "Setting up your Mac",
                    &checklist.body(12),
                    0,
                    &[
                        Action::Primary("Return".into()),
                        Action::Retry,
                        Action::SaveAndExit,
                    ],
                    false,
                    None,
                );
            })
            .unwrap();
        let text: String = terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect();
        assert!(text.contains("Enter Return"), "{text}");
        assert!(text.contains("1Password"), "{text}");
    }

    #[test]
    fn elapsed_time_and_repeated_progress_are_deterministic() {
        let start = Instant::now();
        let mut checklist = Checklist::new_at("fixture-mac", start);
        checklist.begin_at(Step::Tools, "Checking tools", start);
        checklist.offset = 3;

        let later = start + Duration::from_secs(61);
        checklist.begin_at(Step::Tools, "Installing tools", later);
        assert_eq!(checklist.body_at(24, later)[0].0, "fixture-mac · 61s");
        assert_eq!(checklist.offset, 3);
        assert_eq!(checklist.message, "Installing tools");

        checklist.done(Step::Tools);
        checklist.begin_at(Step::Identity, "Checking Git identity", later);
        assert_eq!(checklist.body_at(24, later)[0].0, "fixture-mac · 0s");
        assert_eq!(checklist.offset, 0);
        assert!(checklist.states[Step::Tools.index()] == State::Complete);
    }

    #[test]
    fn retry_resets_only_the_failed_stage() {
        let start = Instant::now();
        let mut checklist = Checklist::new_at("fixture-mac", start);
        checklist.done(Step::Tools);
        checklist.begin_at(Step::Credentials, "Checking backups", start);
        checklist.fail(Step::Credentials, "Synthetic provider unavailable".into());
        checklist.offset = 4;
        assert!(checklist.states[Step::Credentials.index()] == State::Failed);

        let retry = start + Duration::from_secs(120);
        checklist.begin_at(Step::Credentials, "Retrying backup checks", retry);
        assert_eq!(checklist.body_at(24, retry)[0].0, "fixture-mac · 0s");
        assert_eq!(checklist.offset, 0);
        assert!(checklist.states[Step::Tools.index()] == State::Complete);
        assert!(checklist.states[Step::Credentials.index()] == State::Running);
        assert!(checklist.states[Step::Install.index()] == State::Pending);
        assert!(checklist.states[Step::Verify.index()] == State::Pending);
    }

    #[test]
    fn cancellation_and_details_do_not_certify_or_reset_work() {
        let start = Instant::now();
        let mut checklist = Checklist::new_at("fixture-mac", start);
        checklist.begin_at(Step::Install, "Installing configuration", start);
        checklist.key(KeyCode::Esc);
        checklist.key(KeyCode::Char('?'));
        assert!(checklist.details);
        checklist.key(KeyCode::Char('?'));
        assert!(!checklist.details);
        assert!(checklist.cancelled);
        assert!(checklist.states[Step::Install.index()] == State::Running);
        assert!(checklist.states[Step::Verify.index()] == State::Pending);
        assert!(
            checklist
                .body_at(24, start)
                .iter()
                .any(|(line, _)| { line == "Stopping after this step; progress stays saved." })
        );
        assert!(
            !checklist
                .body_at(24, start)
                .iter()
                .any(|(_, role)| *role == Role::Success)
        );
    }

    #[test]
    fn each_step_reports_its_own_state() {
        let mut checklist = Checklist::new("example");
        checklist.done(Step::Tools);
        checklist.done(Step::Identity);
        checklist.begin(Step::Credentials, "Backing up keys");
        assert!(checklist.stages()[2].1 == State::Running);
        checklist.fail(Step::Credentials, "Backup failed".into());
        assert!(checklist.stages()[2].1 == State::Failed);
        checklist.begin(Step::Credentials, "Retrying backup");
        checklist.done(Step::Credentials);
        assert!(checklist.stages()[2].1 == State::Complete);
        checklist.done(Step::Configuration);
        assert!(checklist.stages()[4].1 == State::Pending);
        checklist.done(Step::Install);
        assert!(checklist.stages()[4].1 == State::Complete);
        assert!(checklist.stages()[5].1 == State::Pending);
    }

    #[test]
    fn resume_never_marks_unchecked_stages_successful() {
        let mut checklist = Checklist::new("example");
        checklist.done(Step::Tools);
        checklist.begin(Step::Verify, "Checking existing activation");
        assert!(checklist.states[Step::Install.index()] == State::Pending);
        assert!(checklist.states[Step::Credentials.index()] == State::Pending);
        assert!(checklist.states[Step::Verify.index()] == State::Running);
        assert_eq!(
            checklist
                .body(24)
                .iter()
                .filter(|(line, _)| line.starts_with('✓'))
                .count(),
            1
        );
    }

    #[test]
    fn links_are_exact_github_prs_and_details_exclude_secret_logs() {
        let mut checklist = Checklist::new("example");
        assert!(!checklist.pull_request("example/config", 7, "https://evil.invalid"));
        assert!(!checklist.pull_request(
            "example/config",
            7,
            "https://github.com/example/config/pull/7\x1b"
        ));
        assert!(checklist.pull_request(
            "example/config",
            7,
            "https://github.com/example/config/pull/7"
        ));
        checklist.begin(Step::Credentials, "Verifying saved backups");
        checklist.key(KeyCode::Char('d'));
        let text = checklist
            .body(24)
            .into_iter()
            .map(|(line, _)| line)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(text.contains("1Password"));
        assert!(!text.contains("stdout"));
    }

    #[test]
    fn progress_terminal_child() {
        let Ok(mode) = std::env::var("HOMELAB_CHECKLIST_TEST") else {
            return;
        };
        let _terminal = crate::tui::Terminal::enter().unwrap();
        let mut checklist = Checklist::new("fixture-mac");
        let mut attempts = 0;
        let started = Instant::now();
        if mode == "background" {
            checklist.begin(Step::Install, "Preparing the approved installation");
            let result = checklist
                .background(|| {
                    attempts += 1;
                    std::thread::sleep(Duration::from_millis(1600));
                    Err::<(), _>("Synthetic preparation failure")
                })
                .unwrap();
            assert!(result.is_err());
            assert_eq!(attempts, 1);
            assert!(started.elapsed() >= Duration::from_millis(1600));
            drop(_terminal);
            println!("CHECKLIST_TEST_COMPLETE");
            return;
        }
        let result = checklist
            .run(Step::Credentials, |progress| {
                attempts += 1;
                progress("Verifying saved backups");
                if attempts == 1 {
                    std::thread::sleep(Duration::from_millis(1600));
                    Err(crate::secret_store::Error::Access)
                } else {
                    Ok(())
                }
            })
            .unwrap();
        if mode == "cancel" || mode == "return" {
            assert!(checklist.cancelled && result.is_err());
            assert_eq!(attempts, 1);
            assert!(started.elapsed() >= Duration::from_millis(1600));
        } else {
            assert!(result.is_ok());
            assert_eq!(attempts, 2);
            // Successful suboperations do not certify an entire checklist stage.
            assert!(checklist.states[Step::Credentials.index()] == State::Running);
        }
        drop(_terminal);
        println!("CHECKLIST_TEST_COMPLETE");
    }

    #[test]
    fn elapsed_details_cancel_and_retry_work_during_a_slow_operation() {
        use rustix::fs::{Mode, OFlags, fcntl_setfl, open};
        use rustix::io::{FdFlags, fcntl_setfd};
        use rustix::pty::{OpenptFlags, grantpt, openpt, ptsname, unlockpt};
        use rustix::termios::{Winsize, tcsetwinsize};
        use std::fs::File;
        use std::io::{Read, Write};
        use std::process::{Command, Stdio};
        for mode in ["cancel", "retry", "return", "background"] {
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
                    ws_row: 24,
                    ws_col: 80,
                    ws_xpixel: 0,
                    ws_ypixel: 0,
                },
            )
            .unwrap();
            let mut child = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "setup_wizard::checklist::tests::progress_terminal_child",
                    "--nocapture",
                ])
                .env("HOMELAB_CHECKLIST_TEST", mode)
                .env("TERM", "xterm-256color")
                .stdin(Stdio::from(slave.try_clone().unwrap()))
                .stdout(Stdio::from(slave.try_clone().unwrap()))
                .stderr(Stdio::from(slave))
                .spawn()
                .unwrap();
            fcntl_setfl(&master, OFlags::NONBLOCK).unwrap();
            let mut master = File::from(master);
            let mut output = String::new();
            let mut screen = vt100::Parser::new(24, 80, 0);
            let mut wait = |needle: &str, master: &mut File| {
                let deadline = Instant::now() + Duration::from_secs(10);
                while !screen.screen().contents().contains(needle) {
                    let mut bytes = [0; 4096];
                    match master.read(&mut bytes) {
                        Ok(count) => {
                            screen.process(&bytes[..count]);
                            output.push_str(&String::from_utf8_lossy(&bytes[..count]));
                        }
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => (),
                        Err(error) => panic!("PTY failed: {error}"),
                    }
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        panic!("missing {needle}: {output}");
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
            };
            if mode == "background" {
                wait("Preparing the approved installation", &mut master);
                master.write_all(b"\x03").unwrap();
                wait("Press Ctrl-C again to quit", &mut master);
                master.write_all(b"x").unwrap();
                wait("fixture-mac · 1s", &mut master);
                wait("CHECKLIST_TEST_COMPLETE", &mut master);
                assert!(child.wait().unwrap().success());
                continue;
            }
            wait("Verifying saved backups", &mut master);
            wait("fixture-mac · 1s", &mut master);
            if mode == "cancel" {
                master.write_all(b"?").unwrap();
                wait("Verify recovery backups in 1Password", &mut master);
                master.write_all(b"\x1b").unwrap();
            } else {
                wait("R Retry checks", &mut master);
                master
                    .write_all(if mode == "return" { b"\r" } else { b"r" })
                    .unwrap();
            }
            wait("CHECKLIST_TEST_COMPLETE", &mut master);
            assert!(child.wait().unwrap().success());
        }
    }
}
