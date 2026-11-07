//! Native authentication in a bounded PTY; password keystrokes are never recorded.
use crate::ui::actions::Action;
use std::cell::RefCell;
use std::fs::File;
use std::io::{self, Read, Write};
use std::os::unix::fs::MetadataExt;
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::Path;
use std::process::{Command, ExitStatus, Output, Stdio};
use std::time::{Duration, Instant};

use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use filedescriptor::FileDescriptor;
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use rustix::fs::{Mode, OFlags, open};

use crate::ui::{self, Role};

#[derive(Clone)]
struct Context {
    title: String,
    host: String,
    message: String,
}
thread_local! { static CONTEXT: RefCell<Option<Context>> = const { RefCell::new(None) }; }

#[doc(hidden)]
pub fn within<T>(title: &str, host: &str, operation: impl FnOnce() -> T) -> T {
    struct Restore(Option<Context>);
    impl Drop for Restore {
        fn drop(&mut self) {
            CONTEXT.with(|context| *context.borrow_mut() = self.0.take());
        }
    }
    let previous = CONTEXT.with(|context| {
        context.replace(Some(Context {
            title: title.into(),
            host: host.into(),
            message: "Working…".into(),
        }))
    });
    let _restore = Restore(previous);
    operation()
}

fn context() -> Option<Context> {
    CONTEXT.with(|context| context.borrow().clone())
}

pub(crate) fn progress(message: &str) {
    CONTEXT.with(|context| {
        if let Some(context) = context.borrow_mut().as_mut() {
            context.message = message.into();
        }
    });
    if let Some(context) = context() {
        let _ = draw(&context, "", ProcessScreen::Running);
    }
}

fn password_prompt(text: &str) -> bool {
    text.lines().last().is_some_and(|line| {
        let line = line.to_ascii_lowercase();
        line.contains("password:") || line.contains("passphrase")
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ProcessScreen {
    Running,
    Authentication,
    Failed,
}

impl ProcessScreen {
    fn active(text: &str) -> Self {
        if password_prompt(text) {
            Self::Authentication
        } else {
            Self::Running
        }
    }
}

fn rejected_password(line: &str) -> bool {
    let line = line.trim().to_ascii_lowercase();
    line == "sorry, try again." || line == "permission denied, please try again."
}

fn process_body(context: &Context, text: &str, state: ProcessScreen) -> Vec<(String, Role)> {
    let mut body = vec![
        (context.host.clone(), Role::Context),
        (String::new(), Role::Body),
    ];
    if state == ProcessScreen::Authentication {
        let prompt = text.lines().last().unwrap_or_default();
        let label = if prompt.to_ascii_lowercase().contains("passphrase") {
            "SSH key passphrase:"
        } else {
            "Password:"
        };
        // Only the locally generated mask is rendered, never native prompt history.
        let mask = prompt
            .chars()
            .rev()
            .take_while(|character| *character == '*')
            .count()
            .min(48);
        return ui::components::password_field(
            &context.host,
            label,
            mask,
            text.lines().rev().skip(1).take(2).any(rejected_password),
        );
    }
    let output: Vec<_> = text
        .lines()
        .filter(|line| {
            !line.trim().is_empty() && !password_prompt(line) && !rejected_password(line)
        })
        .collect();
    if state == ProcessScreen::Failed {
        body.push(("Step failed".into(), Role::Warning));
        body.push((String::new(), Role::Body));
        body.extend(output.into_iter().map(|line| (line.to_owned(), Role::Body)));
    } else {
        body.push((
            output
                .last()
                .map_or_else(|| context.message.clone(), |line| (*line).to_owned()),
            Role::Working,
        ));
    }
    body
}

fn draw(context: &Context, text: &str, state: ProcessScreen) -> io::Result<()> {
    let finished = state == ProcessScreen::Failed;
    let authentication = state == ProcessScreen::Authentication;
    let body = process_body(context, text, state);
    let actions = if finished {
        vec![Action::Primary("Continue".into())]
    } else if authentication {
        vec![Action::Submit, Action::Interrupt]
    } else {
        vec![Action::Interrupt]
    };
    ui::render(
        if finished {
            "Setup needs attention"
        } else {
            &context.title
        },
        &body,
        0,
        &actions,
    )?;
    Ok(())
}

#[doc(hidden)]
pub fn status(command: &mut Command) -> io::Result<ExitStatus> {
    if context().is_none() {
        return command.status();
    }
    embedded(command, None, None, Duration::from_secs(90 * 60), None)
}

pub(crate) fn authenticated_status(
    command: &mut Command,
    exchange: Option<crate::setup_auth::Exchange>,
) -> io::Result<ExitStatus> {
    if context().is_none() {
        return command.status();
    }
    embedded(command, None, None, Duration::from_secs(90 * 60), exchange)
}

#[doc(hidden)]
pub fn status_with_input(command: &mut Command, input: &Path) -> io::Result<ExitStatus> {
    if context().is_none() {
        return command.stdin(File::open(input)?).status();
    }
    embedded(
        command,
        Some(input),
        None,
        Duration::from_secs(15 * 60),
        None,
    )
}

#[doc(hidden)]
pub fn capture(
    command: &mut Command,
    timeout: Duration,
) -> Result<Output, crate::process::ProcessError> {
    if context().is_none() {
        return crate::process::capture_with_terminal_stderr(command, timeout);
    }
    let output = tempfile::NamedTempFile::new()?;
    let status = embedded(
        command,
        Some(Path::new("/dev/null")),
        Some(output.path()),
        timeout,
        None,
    )?;
    let mut stdout = Vec::new();
    output
        .reopen()?
        .take(16 * 1024 + 1)
        .read_to_end(&mut stdout)?;
    if stdout.len() > 16 * 1024 {
        return Err(crate::process::ProcessError::ExcessiveOutput);
    }
    Ok(Output {
        status,
        stdout,
        stderr: Vec::new(),
    })
}

fn size() -> io::Result<PtySize> {
    let (cols, rows) = crossterm::terminal::size()?;
    Ok(PtySize {
        rows: rows.saturating_sub(14).clamp(1, 10),
        cols: cols.saturating_sub(8).clamp(1, 68),
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn key_bytes(key: KeyEvent) -> Option<Vec<u8>> {
    if key.kind == KeyEventKind::Release {
        return None;
    }
    if key.modifiers.contains(KeyModifiers::CONTROL) {
        return match key.code {
            KeyCode::Char('u') => Some(vec![21]),
            _ => None,
        };
    }
    match key.code {
        KeyCode::Char(value) if !key.modifiers.contains(KeyModifiers::ALT) => {
            Some(value.to_string().into_bytes())
        }
        KeyCode::Enter => Some(vec![13]),
        KeyCode::Backspace => Some(vec![127]),
        KeyCode::Tab => Some(vec![9]),
        _ => None,
    }
}

fn embedded(
    command: &Command,
    input: Option<&Path>,
    output: Option<&Path>,
    timeout: Duration,
    mut auth_exchange: Option<crate::setup_auth::Exchange>,
) -> io::Result<ExitStatus> {
    let context = context().ok_or_else(|| io::Error::other("No terminal session"))?;
    let mut dimensions = size()?;
    let pair = native_pty_system()
        .openpty(dimensions)
        .map_err(io::Error::other)?;
    #[cfg(not(test))]
    let mut builder = {
        let mut builder = CommandBuilder::new(std::env::current_exe()?);
        builder.arg("terminal-exec");
        if let Some(input) = input {
            builder.arg("--input");
            builder.arg(input);
        }
        if let Some(output) = output {
            builder.arg("--output");
            builder.arg(output);
        }
        builder.arg("--");
        builder.arg(command.get_program());
        builder
    };
    // libtest owns main; the bridge has its own integration tests.
    #[cfg(test)]
    let mut builder = {
        assert!(input.is_none() && output.is_none());
        CommandBuilder::new(command.get_program())
    };
    builder.args(command.get_args());
    for (key, value) in command.get_envs() {
        match value {
            Some(value) => builder.env(key, value),
            None => builder.env_remove(key),
        }
    }
    if let Some(directory) = command.get_current_dir() {
        builder.cwd(directory);
    } else {
        builder.cwd(std::env::current_dir()?);
    }
    builder.env("TERM", "dumb");
    let mut reader = FileDescriptor::dup(
        &pair
            .master
            .as_raw_fd()
            .ok_or_else(|| io::Error::other("PTY unavailable"))?,
    )
    .map_err(io::Error::other)?;
    reader.set_non_blocking(true).map_err(io::Error::other)?;
    let mut writer = pair.master.take_writer().map_err(io::Error::other)?;
    // Discard input queued on a previous screen; it must not answer a new prompt.
    while event::poll(Duration::from_millis(1))? {
        let _ = event::read()?;
    }
    let mut child = pair
        .slave
        .spawn_command(builder)
        .map_err(io::Error::other)?;
    drop(pair.slave);
    let mut parser = vt100::Parser::new(dimensions.rows, dimensions.cols, 0);
    let started = Instant::now();
    let mut masked_length = 0usize;
    let result = (|| {
        let mut exited = None;
        let mut exited_at = None;
        let mut drained = false;
        loop {
            if let Some(exchange) = &mut auth_exchange {
                exchange.observe(&[], &mut writer)?;
            }
            let mut buffer = [0; 4096];
            // A noisy child must not starve keyboard handling or redraws.
            for _ in 0..16 {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        drained = true;
                        break;
                    }
                    Ok(count) => {
                        if let Some(exchange) = &mut auth_exchange {
                            exchange.observe(&buffer[..count], &mut writer)?;
                        }
                        parser.process(&buffer[..count]);
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                    Err(error) if error.raw_os_error() == Some(5) => {
                        drained = true;
                        break;
                    }
                    Err(error) => return Err(error),
                }
            }
            if exited.is_none() {
                exited = child.try_wait()?;
                if exited.is_some() {
                    exited_at = Some(Instant::now());
                }
            }
            if let Some(status) = &exited
                && drained
            {
                if status.signal().is_some() {
                    return Err(io::Error::other(
                        "Native command interrupted; outcome unknown",
                    ));
                }
                return Ok(ExitStatus::from_raw((status.exit_code() as i32) << 8));
            }
            if started.elapsed() > timeout {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "Native command timed out; outcome unknown",
                ));
            }
            if exited_at.is_some_and(|at| at.elapsed() > Duration::from_secs(2)) {
                return Err(io::Error::other(
                    "Native output did not close; outcome unknown",
                ));
            }
            if let Some(path) = output
                && path.metadata()?.len() > 16 * 1024
            {
                return Err(io::Error::other("Protocol output exceeded limit"));
            }
            let text = parser.screen().contents();
            let text = auth_exchange
                .as_ref()
                .map_or(text.clone(), |exchange| exchange.display(&text));
            let authentication = password_prompt(&text);
            let displayed = if authentication {
                format!("{text}{}", "*".repeat(masked_length.min(48)))
            } else {
                masked_length = 0;
                text
            };
            draw(&context, &displayed, ProcessScreen::active(&displayed))?;

            if event::poll(Duration::from_millis(80))? {
                match event::read()? {
                    Event::Key(key) if key.kind != KeyEventKind::Release => {
                        if key.modifiers.contains(KeyModifiers::CONTROL)
                            && key.code == KeyCode::Char('c')
                        {
                            return Err(io::Error::new(
                                io::ErrorKind::Interrupted,
                                "Native command interrupted; outcome unknown",
                            ));
                        }
                        if let Some(mut bytes) = key_bytes(key) {
                            if let Some(exchange) = &mut auth_exchange
                                && !exchange.key(key)
                            {
                                bytes.fill(0);
                                continue;
                            }
                            if authentication {
                                masked_length = match key.code {
                                    KeyCode::Enter => 0,
                                    KeyCode::Backspace => masked_length.saturating_sub(1),
                                    KeyCode::Char('u')
                                        if key.modifiers.contains(KeyModifiers::CONTROL) =>
                                    {
                                        0
                                    }
                                    KeyCode::Char(_) => masked_length.saturating_add(1),
                                    _ => masked_length,
                                };
                            }

                            let sent = writer.write_all(&bytes).and_then(|()| writer.flush());
                            bytes.fill(0);
                            sent?;
                        }
                    }
                    Event::Resize(_, _) => {
                        dimensions = size()?;
                        pair.master.resize(dimensions).map_err(io::Error::other)?;
                        parser.set_size(dimensions.rows, dimensions.cols);
                    }
                    _ => {}
                }
            }
        }
    })();
    if result.is_err() {
        let _ = child.kill();
    }
    let _ = child.wait();
    // Never retain a terminal transcript, including across invocations.
    if result
        .as_ref()
        .is_ok_and(|status| !status.success() && status.code().is_some_and(|code| code < 128))
    {
        let text = parser.screen().contents();
        while event::poll(Duration::from_millis(1))? {
            let _ = event::read()?;
        }
        loop {
            draw(&context, &text, ProcessScreen::Failed)?;
            if let Event::Key(key) = event::read()?
                && key.kind != KeyEventKind::Release
            {
                let code = crate::quit::handle(key);
                if crate::quit::requested()
                    || code == KeyCode::Esc
                    || (code == KeyCode::Enter && crate::setup_wizard::usable_size()?)
                {
                    break;
                }
            }
        }
    }
    while event::poll(Duration::from_millis(1))? {
        let _ = event::read()?;
    }
    result
}

fn private_file(path: &Path, write: bool) -> io::Result<File> {
    let flags = if write {
        OFlags::WRONLY
    } else {
        OFlags::RDONLY
    };
    let file = File::from(open(
        path,
        flags | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    )?);
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o777 != 0o600
    {
        return Err(io::Error::other("Invalid private transport file"));
    }
    Ok(file)
}

/// Internal same-user exec bridge. Only native SSH/sudo reads the controlling PTY;
/// public-key stdin and protocol stdout must remain separate from authentication.
pub fn exec_bridge(
    input: Option<&Path>,
    output: Option<&Path>,
    arguments: &[std::ffi::OsString],
) -> io::Result<()> {
    let (program, arguments) = arguments
        .split_first()
        .ok_or_else(|| io::Error::other("Missing native command"))?;
    let mut command = Command::new(program);
    command.args(arguments);
    if let Some(path) = input {
        if path == Path::new("/dev/null") {
            command.stdin(Stdio::null());
        } else {
            command.stdin(private_file(path, false)?);
        }
    }
    if let Some(path) = output {
        command.stdout(private_file(path, true)?);
    }
    Err(command.exec())
}

/// Shared by the CLI and disposable-VM harness, before their normal entry points.
#[doc(hidden)]
pub fn dispatch_bridge() -> Option<std::process::ExitCode> {
    use clap::Parser;
    #[derive(Parser)]
    struct Arguments {
        #[arg(long)]
        input: Option<std::path::PathBuf>,
        #[arg(long)]
        output: Option<std::path::PathBuf>,
        #[arg(last = true, required = true)]
        command: Vec<std::ffi::OsString>,
    }
    let arguments: Vec<_> = std::env::args_os().skip(1).collect();
    if arguments
        .first()
        .is_none_or(|argument| argument != "terminal-exec")
    {
        return None;
    }
    if let Ok(arguments) = Arguments::try_parse_from(arguments) {
        let _ = exec_bridge(
            arguments.input.as_deref(),
            arguments.output.as_deref(),
            &arguments.command,
        );
    }
    eprintln!("Native authentication transport could not start.");
    Some(std::process::ExitCode::FAILURE)
}
