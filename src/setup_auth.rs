//! Attempt-scoped sudo credentials. Never serialize them or pass them through argv.
use std::cell::RefCell;
use std::fs::File;
use std::io::{self, Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use rustix::process::{Resource, Rlimit, getrlimit, setrlimit};
use zeroize::Zeroizing;

use crate::inventory::HostProfile;

struct Password {
    bytes: Zeroizing<[u8; 1024]>,
    length: usize,
    cacheable: bool,
}

impl Password {
    fn new() -> Self {
        Self {
            bytes: Zeroizing::new([0; 1024]),
            length: 0,
            cacheable: true,
        }
    }
    fn clear(&mut self) {
        self.bytes.fill(0);
        self.length = 0;
        self.cacheable = true;
    }
    fn key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => self.clear(),
            KeyCode::Backspace if self.length > 0 => {
                let text = std::str::from_utf8(&self.bytes[..self.length]).unwrap_or("");
                let size = text.chars().next_back().map_or(1, char::len_utf8);
                self.bytes[self.length - size..self.length].fill(0);
                self.length -= size;
            }
            KeyCode::Char(value)
                if !key
                    .modifiers
                    .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
            {
                let mut encoded = [0; 4];
                let count = value.encode_utf8(&mut encoded).len();
                if self.length + count <= self.bytes.len() {
                    self.bytes[self.length..self.length + count].copy_from_slice(&encoded[..count]);
                    self.length += count;
                } else {
                    self.cacheable = false;
                }
                encoded.fill(0);
            }
            KeyCode::Backspace => {}
            _ => self.cacheable = false,
        }
    }
}

struct Attempt {
    target: HostProfile,
    password: Option<Password>,
    host_key: Option<tempfile::NamedTempFile>,
}
thread_local! { static ATTEMPT: RefCell<Option<Attempt>> = const { RefCell::new(None) }; }

pub(crate) struct Scope;
pub(crate) fn active() -> bool {
    ATTEMPT.with(|state| state.borrow().is_some())
}
impl Scope {
    pub(crate) fn begin_verified(target: &HostProfile, ssh: &Path) -> io::Result<Self> {
        let mut command = Command::new(ssh);
        let _identity = crate::ssh_identity::configure(&mut command, target.identity.as_ref())?;
        command
            .args(crate::ssh::OPTIONS)
            .args(["-T", "-o", "ControlPath=none", "-l"])
            .arg(&target.user)
            .arg(&target.address)
            .arg("/bin/cat /etc/ssh/ssh_host_ed25519_key.pub")
            .stdin(Stdio::null());
        let output = crate::process::capture(&mut command, Duration::from_secs(30))
            .map_err(|_| io::Error::other("Could not verify the Mac's SSH identity"))?;
        let key = std::str::from_utf8(&output.stdout)
            .ok()
            .and_then(crate::ssh_identity::canonical_key)
            .filter(|key| key.starts_with("ssh-ed25519 "))
            .filter(|_| output.status.success())
            .ok_or_else(|| io::Error::other("Could not pin the verified Mac's SSH identity"))?;
        let mut file = tempfile::NamedTempFile::new()?;
        writeln!(file, "{} {key}", target.address)?;
        let scope = Self::begin(target)?;
        ATTEMPT.with(|state| state.borrow_mut().as_mut().unwrap().host_key = Some(file));
        Ok(scope)
    }
    pub(crate) fn begin(target: &HostProfile) -> io::Result<Self> {
        let limit = getrlimit(Resource::Core);
        setrlimit(
            Resource::Core,
            Rlimit {
                current: Some(0),
                maximum: limit.maximum,
            },
        )?;
        if ATTEMPT.with(|state| state.borrow().is_some()) {
            return Err(io::Error::other(
                "A setup authentication scope is already active",
            ));
        }
        ATTEMPT.with(|state| {
            *state.borrow_mut() = Some(Attempt {
                target: target.clone(),
                password: None,
                host_key: None,
            })
        });
        Ok(Self)
    }
}

pub(crate) fn pin(command: &mut Command, target: &HostProfile) {
    ATTEMPT.with(|state| {
        let state = state.borrow();
        if let Some(attempt) = state.as_ref().filter(|attempt| attempt.target == *target)
            && let Some(file) = &attempt.host_key
        {
            command
                .args([
                    "-o",
                    "HostKeyAlgorithms=ssh-ed25519",
                    "-o",
                    "GlobalKnownHostsFile=/dev/null",
                    "-o",
                    "UpdateHostKeys=no",
                    "-o",
                    "StrictHostKeyChecking=yes",
                    "-o",
                    "ControlPath=none",
                ])
                .arg("-o")
                .arg(format!("UserKnownHostsFile={}", file.path().display()));
        }
    });
}

impl Drop for Exchange {
    fn drop(&mut self) {
        if !self.finished {
            ATTEMPT.with(|state| {
                if let Some(attempt) = state.borrow_mut().as_mut() {
                    attempt.password = None;
                }
            });
        }
    }
}
impl Drop for Scope {
    fn drop(&mut self) {
        ATTEMPT.with(|state| *state.borrow_mut() = None);
    }
}

pub(crate) struct Exchange {
    prompt: String,
    accepted: String,
    password: Password,
    submitted: bool,
    reused: bool,
    pending: Vec<u8>,
    awaiting: bool,
    finished: bool,
    started: Instant,
}

impl Exchange {
    /// The caller must execute this prefix before any helper or build output.
    pub(crate) fn prepare(
        target: &HostProfile,
        remote: &str,
    ) -> io::Result<Option<(String, Self)>> {
        if !ATTEMPT.with(|state| {
            state
                .borrow()
                .as_ref()
                .is_some_and(|attempt| attempt.target == *target)
        }) {
            return Ok(None);
        }
        let mut random = [0; 8];
        File::open("/dev/urandom")?.read_exact(&mut random)?;
        let nonce: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let prompt = format!("HL-{nonce} password:");
        let accepted = format!("HL-{nonce}-accepted");
        let command = format!(
            "LC_ALL=C /usr/bin/sudo -v -p '{prompt}' && /usr/bin/printf '\\n{accepted}\\n' && {remote}"
        );
        Ok(Some((
            command,
            Self {
                prompt,
                accepted,
                password: Password::new(),
                submitted: false,
                reused: false,
                pending: Vec::new(),
                awaiting: false,
                finished: false,
                started: Instant::now(),
            },
        )))
    }

    pub(crate) fn observe(&mut self, bytes: &[u8], writer: &mut impl Write) -> io::Result<()> {
        if self.finished {
            return Ok(());
        }
        if self.started.elapsed() > Duration::from_secs(180) {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Administrator authentication timed out",
            ));
        }
        for byte in bytes {
            self.pending.push(*byte);
            if self.pending.ends_with(self.accepted.as_bytes()) {
                self.finished = true;
                self.awaiting = false;
                self.pending.clear();
                if self.submitted
                    && !self.reused
                    && self.password.cacheable
                    && self.password.length > 0
                {
                    let password = std::mem::replace(&mut self.password, Password::new());
                    ATTEMPT.with(|state| {
                        if let Some(attempt) = state.borrow_mut().as_mut() {
                            attempt.password = Some(password);
                        }
                    });
                }
                return Ok(());
            }
            if self.pending.ends_with(b"Sorry, try again.") {
                self.password.clear();
                self.submitted = false;
                ATTEMPT.with(|state| {
                    if let Some(attempt) = state.borrow_mut().as_mut() {
                        attempt.password = None;
                    }
                });
            }
            if self.pending.ends_with(self.prompt.as_bytes()) {
                self.awaiting = true;
                if !self.reused && !self.submitted {
                    self.reused = true;
                    self.submitted = ATTEMPT.with(|state| -> io::Result<bool> {
                        let state = state.borrow();
                        let Some(password) =
                            state.as_ref().and_then(|attempt| attempt.password.as_ref())
                        else {
                            return Ok(false);
                        };
                        writer.write_all(&password.bytes[..password.length])?;
                        writer.write_all(b"\r")?;
                        writer.flush()?;
                        Ok(true)
                    })?;
                }
            }
            let keep = self.prompt.len().max(self.accepted.len()).max(32);
            if self.pending.len() > keep {
                self.pending.drain(..self.pending.len() - keep);
            }
        }
        Ok(())
    }

    pub(crate) fn key(&mut self, key: KeyEvent) -> bool {
        if self.finished || self.submitted || !self.awaiting {
            return false;
        }
        if key.code == KeyCode::Enter {
            self.submitted = true;
            // User input replaces a rejected cached credential.
            self.reused = false;
        } else {
            self.password.key(key);
        }
        true
    }

    pub(crate) fn display(&self, text: &str) -> String {
        if self.submitted && !self.finished {
            return "Authenticating…".to_owned();
        }
        text.lines()
            .filter(|line| {
                !line.contains(&self.accepted)
                    && !(self.finished
                        && (line.contains(&self.prompt) || line.contains("Sorry, try again.")))
            })
            .collect::<Vec<_>>()
            .join("\n")
            .replace(&self.prompt, "Administrator password:")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target() -> HostProfile {
        HostProfile {
            name: "fixture".into(),
            address: "fixture.local".into(),
            user: "admin".into(),
            identity: None,
            configuration_host: Some("fixture".into()),
        }
    }
    fn enter(exchange: &mut Exchange) {
        exchange
            .observe(exchange.prompt.clone().as_bytes(), &mut Vec::new())
            .unwrap();
        for value in "synthetic-password".chars() {
            exchange.key(KeyEvent::new(KeyCode::Char(value), KeyModifiers::NONE));
        }
        exchange.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
    }
    fn authenticated(exchange: &mut Exchange) {
        exchange
            .observe(exchange.accepted.clone().as_bytes(), &mut Vec::new())
            .unwrap();
    }
    #[test]
    fn credential_is_scoped_to_target_and_cleared_at_attempt_end() {
        let target = target();
        let scope = Scope::begin(&target).unwrap();
        let (_, mut exchange) = Exchange::prepare(&target, "true").unwrap().unwrap();
        enter(&mut exchange);
        authenticated(&mut exchange);
        let mut other = target.clone();
        other.user = "someone-else".into();
        assert!(Exchange::prepare(&other, "true").unwrap().is_none());
        let (_, mut second) = Exchange::prepare(&target, "true").unwrap().unwrap();
        let mut output = Vec::new();
        second
            .observe(second.prompt.clone().as_bytes(), &mut output)
            .unwrap();
        assert_eq!(output, b"synthetic-password\r");
        drop(scope);
        assert!(ATTEMPT.with(|state| state.borrow().is_none()));
    }
    #[test]
    fn arbitrary_prompts_and_output_after_authentication_cannot_replay_password() {
        let target = target();
        let _scope = Scope::begin(&target).unwrap();
        let (_, mut first) = Exchange::prepare(&target, "true").unwrap().unwrap();
        enter(&mut first);
        authenticated(&mut first);
        let (_, mut exchange) = Exchange::prepare(&target, "true").unwrap().unwrap();
        let mut output = Vec::new();
        exchange
            .observe(b"Password: passphrase: 1Password", &mut output)
            .unwrap();
        assert!(output.is_empty());
        authenticated(&mut exchange);
        exchange
            .observe(exchange.prompt.clone().as_bytes(), &mut output)
            .unwrap();
        assert!(output.is_empty());
    }
    #[test]
    fn rejected_cache_is_erased_and_never_retried_automatically() {
        let target = target();
        let _scope = Scope::begin(&target).unwrap();
        let (_, mut first) = Exchange::prepare(&target, "true").unwrap().unwrap();
        enter(&mut first);
        authenticated(&mut first);
        let (_, mut exchange) = Exchange::prepare(&target, "true").unwrap().unwrap();
        let mut output = Vec::new();
        exchange
            .observe(exchange.prompt.clone().as_bytes(), &mut output)
            .unwrap();
        let rejection = format!("Sorry, try again.\n{}", exchange.prompt);
        output.clear();
        exchange.observe(rejection.as_bytes(), &mut output).unwrap();
        exchange.observe(rejection.as_bytes(), &mut output).unwrap();
        assert!(output.is_empty());
        assert!(ATTEMPT.with(|state| state.borrow().as_ref().unwrap().password.is_none()));
    }

    #[test]
    fn fragmented_acceptance_disarms_before_scrolling_or_spoofed_output() {
        let target = target();
        let _scope = Scope::begin(&target).unwrap();
        let (_, mut exchange) = Exchange::prepare(&target, "true").unwrap().unwrap();
        enter(&mut exchange);
        let accepted = exchange.accepted.clone();
        let mut output = Vec::new();
        for byte in accepted.bytes() {
            exchange.observe(&[byte], &mut output).unwrap();
        }
        let noisy = format!("\x1b[2J{}{}", "output\n".repeat(10000), exchange.prompt);
        exchange.observe(noisy.as_bytes(), &mut output).unwrap();
        assert!(exchange.finished);
        assert!(output.is_empty());
        assert!(!exchange.display(&exchange.prompt).contains("password:"));
        assert!(!exchange.key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE)));
    }

    #[test]
    fn unsupported_editing_and_overflow_are_not_cached() {
        for unsupported in [true, false] {
            let target = target();
            let _scope = Scope::begin(&target).unwrap();
            let (_, mut exchange) = Exchange::prepare(&target, "true").unwrap().unwrap();
            exchange
                .observe(exchange.prompt.clone().as_bytes(), &mut Vec::new())
                .unwrap();
            if unsupported {
                exchange.key(KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE));
            } else {
                for _ in 0..1025 {
                    exchange.key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE));
                }
            }
            exchange.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
            assert!(!exchange.key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE)));
            authenticated(&mut exchange);
            assert!(ATTEMPT.with(|state| state.borrow().as_ref().unwrap().password.is_none()));
        }
    }

    #[test]
    fn interrupted_exchange_erases_previous_cached_password() {
        let target = target();
        let _scope = Scope::begin(&target).unwrap();
        let (_, mut first) = Exchange::prepare(&target, "true").unwrap().unwrap();
        enter(&mut first);
        authenticated(&mut first);
        let (_, exchange) = Exchange::prepare(&target, "true").unwrap().unwrap();
        drop(exchange);
        assert!(ATTEMPT.with(|state| state.borrow().as_ref().unwrap().password.is_none()));
    }

    #[test]
    fn embedded_authentication_child() {
        if std::env::var_os("HOMELAB_TEST_AUTH_CHILD").is_none() {
            return;
        }
        crossterm::terminal::enable_raw_mode().unwrap();
        let target = target();
        let _scope = Scope::begin(&target).unwrap();
        for _ in 0..2 {
            let (_, exchange) = Exchange::prepare(&target, "true").unwrap().unwrap();
            let mut command = Command::new("/bin/sh");
            command.args([
                "-c",
                r#"
                stty sane -echo
                printf '%s' "$1"
                IFS= read -r password
                test "$password" = synthetic-password || exit 9
                unset password
                printf '\n%s\n' "$2"
                printf '\033[2JBuilding configuration…\n'
            "#,
                "fixture",
                &exchange.prompt,
                &exchange.accepted,
            ]);
            let result = crate::terminal_process::within("Setting up your Mac", "fixture", || {
                crate::terminal_process::authenticated_status(&mut command, Some(exchange))
            });
            assert!(result.unwrap().success());
        }
        crossterm::terminal::disable_raw_mode().unwrap();
        println!("SCOPED_AUTH_VERIFIED");
    }

    #[test]
    fn production_pty_reuses_one_entry_across_two_exchanges() {
        use filedescriptor::FileDescriptor;
        use portable_pty::{CommandBuilder, PtySize, native_pty_system};
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 30,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = CommandBuilder::new(std::env::current_exe().unwrap());
        command.cwd(std::env::current_dir().unwrap());
        command.args([
            "--exact",
            "setup_auth::tests::embedded_authentication_child",
            "--nocapture",
        ]);
        command.env("HOMELAB_TEST_AUTH_CHILD", "1");
        let mut child = pair.slave.spawn_command(command).unwrap();
        drop(pair.slave);
        let mut reader = FileDescriptor::dup(&pair.master.as_raw_fd().unwrap()).unwrap();
        reader.set_non_blocking(true).unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let mut parser = vt100::Parser::new(30, 100, 0);
        let mut transcript = Vec::new();
        let mut answered = false;
        let started = Instant::now();
        loop {
            let mut bytes = [0; 4096];
            match reader.read(&mut bytes) {
                Ok(count) => {
                    parser.process(&bytes[..count]);
                    transcript.extend_from_slice(&bytes[..count]);
                }
                Err(error)
                    if error.kind() == io::ErrorKind::WouldBlock
                        || error.raw_os_error() == Some(5) => {}
                Err(error) => panic!("PTY read failed: {error}"),
            }
            if !answered && parser.screen().contents().contains("Password:") {
                answered = true;
                writer.write_all(b"synthetic-password\r").unwrap();
            }
            if let Some(status) = child.try_wait().unwrap() {
                assert!(status.success());
                break;
            }
            if started.elapsed() > Duration::from_secs(15) {
                let _ = child.kill();
                let _ = child.wait();
                panic!(
                    "Authentication PTY did not complete: {}",
                    parser
                        .screen()
                        .contents()
                        .replace("synthetic-password", "[fixture input]")
                );
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            answered,
            "Synthetic child output: {}",
            String::from_utf8_lossy(&transcript)
        );
        assert!(!String::from_utf8_lossy(&transcript).contains("synthetic-password"));
    }
}
