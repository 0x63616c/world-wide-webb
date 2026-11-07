//! Presentation only: durable journals, not these rows, decide what can resume.
use std::io;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crossterm::event::{self, Event, KeyCode, KeyEventKind, KeyModifiers};
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
                "Use working developer tools or install Apple's Command Line Tools. Administrator authentication may appear outside this screen."
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
                "Install the exact approved revision. Native SSH and sudo own password prompts; an uncertain activation is never blindly repeated."
            }
            Self::Verify => {
                "Verify services, remote access, reboot and Git reconciliation before releasing the update hold. FileVault may need local unlock."
            }
        }
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    Pending,
    Current,
    Done,
    Failed,
}
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
        Self {
            host: host.into(),
            states: [State::Pending; 6],
            current: Step::Tools,
            started: Instant::now(),
            message: String::new(),
            details: false,
            offset: 0,
            last_offset: 0,
            link: None,
            cancelled: false,
        }
    }
    pub(super) fn begin(&mut self, step: Step, message: &str) {
        if self.current != step || self.states[step.index()] != State::Current {
            self.started = Instant::now();
            self.offset = 0;
        }
        self.current = step;
        self.states[step.index()] = State::Current;
        self.message = message.into();
    }
    pub(super) fn done(&mut self, step: Step) {
        self.states[step.index()] = State::Done;
    }
    pub(super) fn native_status(&self) -> String {
        let mut lines = vec![format!("Setup · {}", self.host)];
        for step in STEPS {
            let symbol = match self.states[step.index()] {
                State::Pending => "○",
                State::Current => "›",
                State::Done => "✓",
                State::Failed => "!",
            };
            lines.push(format!("{symbol} {}", step.label()));
        }
        lines.push(
            "Native authentication is using the terminal; the checklist returns afterward.".into(),
        );
        lines.join("\n")
    }
    pub(super) fn message(&mut self, message: &str) {
        self.message = message.into();
    }
    fn body(&self, height: usize) -> Vec<(String, Role)> {
        let mut body = vec![(
            format!("{} · {}s", self.host, self.started.elapsed().as_secs()),
            Role::Context,
        )];
        if self.details {
            body.push((self.current.label().into(), Role::Section));
            body.push((self.current.explanation().into(), Role::Body));
            body.push((String::new(), Role::Body));
            body.push((self.message.clone(), Role::Body));
            return body;
        }
        // Small terminals show the current neighborhood; no unseen row is claimed complete.
        let count = if height < 18 { 2 } else { 6 };
        let start = self.current.index().saturating_sub(count - 1);
        for step in STEPS.iter().skip(start).take(count) {
            let (symbol, role) = match self.states[step.index()] {
                State::Pending => ("○", Role::Pending),
                State::Current => ("›", Role::Selected),
                State::Done => ("✓", Role::Success),
                State::Failed => ("!", Role::Warning),
            };
            body.push((format!("{symbol} {}", step.label()), role));
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
    pub(super) fn draw(&mut self, actions: &str) -> io::Result<()> {
        let (_, height) = terminal::size()?;
        self.last_offset = super::render_with_link(
            "Set up your Mac",
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
            KeyCode::Char('d' | 'D') => {
                self.details = !self.details;
                self.offset = 0;
            }
            KeyCode::Up => self.offset = self.offset.saturating_sub(1),
            KeyCode::Down => self.offset = (self.offset + 1).min(self.last_offset),
            KeyCode::Esc => self.cancelled = true,
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
        while event::poll(Duration::ZERO)? {
            if let Event::Key(key) = event::read()?
                && key.kind != KeyEventKind::Release
            {
                self.key(
                    if key.code == KeyCode::Char('c')
                        && key.modifiers.contains(KeyModifiers::CONTROL)
                    {
                        KeyCode::Esc
                    } else {
                        key.code
                    },
                );
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
                        if redraw.elapsed() >= Duration::from_secs(1) {
                            self.draw(if self.link.is_some() {
                                "O Open PR · D Details · ↑/↓ Read · Esc Stop after step"
                            } else {
                                "D Details · ↑/↓ Read · Esc Stop after step"
                            })?;
                            redraw = Instant::now();
                        }
                        if event::poll(Duration::from_millis(100))?
                            && let Event::Key(key) = event::read()?
                            && key.kind != KeyEventKind::Release
                        {
                            self.key(
                                if key.code == KeyCode::Char('c')
                                    && key.modifiers.contains(KeyModifiers::CONTROL)
                                {
                                    KeyCode::Esc
                                } else {
                                    key.code
                                },
                            );
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
                    self.states[step.index()] = State::Failed;
                    self.message = format!("{}", error);
                    if self.cancelled {
                        return Ok(Err(error));
                    }
                    loop {
                        self.draw("R Retry checks · D Details · ↑/↓ Read · Esc Save and exit")?;
                        match super::key()? {
                            KeyCode::Char('r' | 'R') => break,
                            KeyCode::Esc => {
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
    fn resume_never_marks_unchecked_stages_successful() {
        let mut checklist = Checklist::new("example");
        checklist.done(Step::Tools);
        checklist.begin(Step::Verify, "Checking existing activation");
        assert!(checklist.states[Step::Install.index()] == State::Pending);
        assert!(checklist.states[Step::Credentials.index()] == State::Pending);
        assert!(checklist.states[Step::Verify.index()] == State::Current);
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
            assert!(checklist.states[Step::Credentials.index()] == State::Current);
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
            let mut wait = |needle: &str, master: &mut File| {
                let deadline = Instant::now() + Duration::from_secs(10);
                while !output.contains(needle) {
                    let mut bytes = [0; 4096];
                    match master.read(&mut bytes) {
                        Ok(count) => output.push_str(&String::from_utf8_lossy(&bytes[..count])),
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
                master.write_all(b"d").unwrap();
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
