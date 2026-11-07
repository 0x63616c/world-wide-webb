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
}
const STEPS: [Step; 6] = [
    Step::Tools,
    Step::Identity,
    Step::Credentials,
    Step::Configuration,
    Step::Install,
    Step::Verify,
];
impl Step {
    fn index(self) -> usize {
        STEPS.iter().position(|step| *step == self).unwrap()
    }
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Tools => "Check developer tools",
            Self::Identity => "Prepare Git identity",
            Self::Credentials => "Back up and encrypt keys",
            Self::Configuration => "Save configuration in Git",
            Self::Install => "Install approved configuration",
            Self::Verify => "Verify reboot and Git updates",
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
                "Verify services, remote access, reboot and Git reconciliation before releasing the update hold. FileVault may need local unlock."
            }
        }
    }
}
use crate::ui::components::ProgressState as State;
pub(super) struct Checklist {
    host: String,
    states: [State; 6],
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
            states: [State::Pending; 6],
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
    fn fail(&mut self, step: Step, message: String) {
        self.states[step.index()] = State::Failed;
        self.message = message;
    }

    fn stages(&self) -> [(&'static str, State); 3] {
        [
            (
                ("Prepare", "Preparing", "Prepared", "Preparation failed"),
                &self.states[..3],
            ),
            (
                ("Install", "Installing", "Installed", "Installation failed"),
                &self.states[3..5],
            ),
            (
                ("Verify", "Verifying", "Verified", "Verification failed"),
                &self.states[5..],
            ),
        ]
        .map(|(label, states)| {
            let state = if states.contains(&State::Failed) {
                State::Failed
            } else if states.contains(&State::Running) {
                State::Running
            } else if states.iter().all(|state| *state == State::Complete) {
                State::Complete
            } else {
                State::Pending
            };
            let label = match state {
                State::Pending => label.0,
                State::Running => label.1,
                State::Complete => label.2,
                State::Failed => label.3,
            };
            (label, state)
        })
    }

    pub(super) fn checkpoint(&mut self, message: &str) -> io::Result<bool> {
        self.message(message);
        loop {
            self.draw(&[
                Action::Primary("Continue".into()),
                Action::Navigation,
                Action::Back,
                Action::Help,
            ])?;
            match super::key()? {
                KeyCode::Enter if super::usable_size()? && self.offset >= self.last_offset => {
                    return Ok(true);
                }
                KeyCode::Enter => self.offset = (self.offset + 3).min(self.last_offset),
                code if Action::Back.matches(code) => return Ok(false),
                key => self.key(key),
            }
        }
    }

    pub(super) fn message(&mut self, message: &str) {
        self.message = message.into();
    }
    fn body(&self, height: usize) -> Vec<(String, Role)> {
        self.body_at(height, Instant::now())
    }

    fn body_at(&self, height: usize, now: Instant) -> Vec<(String, Role)> {
        let elapsed = now.saturating_duration_since(self.started);
        let mut body = vec![(
            format!("{} · {}s", self.host, elapsed.as_secs()),
            Role::Context,
        )];
        body.push((String::new(), Role::Body));
        if self.details {
            body.push((self.current.label().into(), Role::Section));
            body.push((self.current.explanation().into(), Role::Body));
            body.push((String::new(), Role::Body));
            body.push((self.message.clone(), Role::Body));
            return body;
        }
        for (label, state) in self.stages() {
            body.push(state.row(label));
        }
        if height >= 18 {
            body.push((String::new(), Role::Body));
        }
        if self.link.is_some() {
            body.push(("Open enrollment PR".into(), Role::Action));
        }
        body.push((
            if self.cancelled {
                "Stopping after this step; progress stays saved.".into()
            } else {
                self.message.clone()
            },
            Role::Body,
        ));
        body
    }
    pub(super) fn draw(&mut self, actions: &[Action]) -> io::Result<()> {
        let (_, height) = terminal::size()?;
        self.last_offset = super::render_with_link(
            "Setting up your Mac",
            &self.body(usize::from(height)),
            self.offset,
            actions,
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
                    let _ = std::process::Command::new("/usr/bin/open")
                        .arg(url)
                        .stdin(std::process::Stdio::null())
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .status();
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
                    if self.cancelled {
                        return Ok(Err(error));
                    }
                    loop {
                        self.draw(&[
                            Action::Retry,
                            Action::Help,
                            Action::Navigation,
                            Action::SaveAndExit,
                        ])?;
                        match super::key()? {
                            KeyCode::Char('r' | 'R') => break,
                            code if Action::Back.matches(code) => {
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
    fn grouped_stages_require_every_internal_step_to_succeed() {
        let mut checklist = Checklist::new("example");
        checklist.done(Step::Tools);
        checklist.done(Step::Identity);
        checklist.begin(Step::Credentials, "Backing up keys");
        assert!(checklist.stages()[0].1 == State::Running);
        checklist.fail(Step::Credentials, "Backup failed".into());
        assert!(checklist.stages()[0].1 == State::Failed);
        checklist.begin(Step::Credentials, "Retrying backup");
        checklist.done(Step::Credentials);
        assert!(checklist.stages()[0].1 == State::Complete);
        checklist.done(Step::Configuration);
        assert!(checklist.stages()[1].1 == State::Pending);
        checklist.done(Step::Install);
        assert!(checklist.stages()[1].1 == State::Complete);
        assert!(checklist.stages()[2].1 == State::Pending);
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
            0
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
        let result = checklist
            .run(Step::Credentials, |progress| {
                attempts += 1;
                progress("Verifying saved backups");
                if attempts == 1 {
                    std::thread::sleep(Duration::from_millis(1600));
                    Err("Synthetic backup unavailable; unlock the provider")
                } else {
                    Ok(())
                }
            })
            .unwrap();
        if mode == "cancel" {
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
        for mode in ["cancel", "retry"] {
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
            wait("Verifying saved backups", &mut master);
            wait("fixture-mac · 1s", &mut master);
            if mode == "cancel" {
                master.write_all(b"?").unwrap();
                wait("Verify recovery backups in 1Password", &mut master);
                master.write_all(b"\x1b").unwrap();
            } else {
                wait("R Retry checks", &mut master);
                master.write_all(b"r").unwrap();
            }
            wait("CHECKLIST_TEST_COMPLETE", &mut master);
            assert!(child.wait().unwrap().success());
        }
    }
}
