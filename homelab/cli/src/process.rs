use std::cell::Cell;
use std::io::{self, Read, Write};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, ExitStatus, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use rustix::fs::{OFlags, fcntl_getfl, fcntl_setfl};
use rustix::process::{
    Pid, Signal, WaitId, WaitIdOptions, kill_process_group, test_kill_process_group, waitid,
};
use thiserror::Error;

const OUTPUT_LIMIT: usize = 16 * 1024;

#[derive(Debug, Error)]
pub enum ProcessError {
    #[error("The command could not be executed or supervised.")]
    Io(#[from] io::Error),
    #[error("The command exceeded its time limit.")]
    Timeout,
    #[error("The command exceeded its output limit.")]
    ExcessiveOutput,
}

impl From<rustix::io::Errno> for ProcessError {
    fn from(error: rustix::io::Errno) -> Self {
        Self::Io(error.into())
    }
}

fn read_available(
    pipe: &mut impl Read,
    destination: &mut Vec<u8>,
    combined_size: &mut usize,
    limit: usize,
) -> Result<bool, ProcessError> {
    let mut buffer = [0; 4096];
    match pipe.read(&mut buffer) {
        Ok(0) => Ok(true),
        Ok(count) => {
            if *combined_size + count > limit {
                return Err(ProcessError::ExcessiveOutput);
            }
            destination.extend_from_slice(&buffer[..count]);
            *combined_size += count;
            Ok(false)
        }
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
            ) =>
        {
            Ok(false)
        }
        Err(error) => Err(error.into()),
    }
}

pub(crate) fn run(
    executable: &Path,
    arguments: &[&str],
    timeout: Duration,
) -> Result<Output, ProcessError> {
    let mut command = Command::new(executable);
    command
        .args(arguments)
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("LC_ALL", "C")
        .stdin(Stdio::null());
    capture(&mut command, timeout)
}

pub fn capture(command: &mut Command, timeout: Duration) -> Result<Output, ProcessError> {
    supervise(command, timeout, OutputMode::Capture)
}

/// A bounded in-memory stdin channel. Secret input never needs a temporary file,
/// an environment variable, a shell command, or a command-line argument.
pub(crate) fn capture_input(
    command: &mut Command,
    input: &[u8],
    timeout: Duration,
) -> Result<Output, ProcessError> {
    if input.len() > 16 * 1024 {
        return Err(ProcessError::ExcessiveOutput);
    }
    // Some CLIs (including op) accept templates only when stdin is a real pipe.
    // A UnixStream can be read as stdin but is ignored by their input detection.
    let (reader, writer) = rustix::pipe::pipe()?;
    rustix::io::fcntl_setfd(&reader, rustix::io::FdFlags::CLOEXEC)?;
    rustix::io::fcntl_setfd(&writer, rustix::io::FdFlags::CLOEXEC)?;
    command.stdin(Stdio::from(reader));
    thread::scope(|scope| {
        let writing = scope.spawn(move || {
            let mut writer = std::fs::File::from(writer);
            writer.write_all(input)
        });
        let captured = capture(command, timeout);
        // A failed spawn must also close the reader retained by Command, so its
        // writer cannot block after the supervised operation has ended.
        command.stdin(Stdio::null());
        let written = writing
            .join()
            .map_err(|_| io::Error::other("Command input stopped"))?;
        let output = captured?;
        written?;
        Ok(output)
    })
}

pub(crate) fn capture_status(
    command: &mut Command,
    timeout: Duration,
) -> Result<Output, ProcessError> {
    supervise(command, timeout, OutputMode::Status)
}

/// Interactive authentication may display a browser approval link on stderr.
/// Use only for public transport diagnostics, never commands handling secrets.
pub fn capture_with_terminal_stderr(
    command: &mut Command,
    timeout: Duration,
) -> Result<Output, ProcessError> {
    supervise(command, timeout, OutputMode::TerminalStderr)
}

pub fn run_silent(command: &mut Command, timeout: Duration) -> Result<ExitStatus, ProcessError> {
    supervise(command, timeout, OutputMode::Discard).map(|output| output.status)
}

/// Discard stdout and retain only a bounded stderr tail. Diagnostic volume must
/// never turn a completed mutation into an excessive-output failure.
pub fn run_diagnostic(command: &mut Command, timeout: Duration) -> Result<Output, ProcessError> {
    supervise(command, timeout, OutputMode::Diagnostic)
}

pub(crate) enum OutputMode {
    Capture,
    Diagnostic,
    Discard,
    TerminalStderr,
    Status,
}

type Executor = fn(&mut Command, Duration, OutputMode) -> Result<Output, ProcessError>;
thread_local! { static EXECUTOR: Cell<Option<Executor>> = const { Cell::new(None) }; }

pub(crate) struct ExecutionScope(Option<Executor>);
impl ExecutionScope {
    pub(crate) fn enter(executor: Executor) -> Self {
        Self(EXECUTOR.replace(Some(executor)))
    }
}
impl Drop for ExecutionScope {
    fn drop(&mut self) {
        EXECUTOR.set(self.0);
    }
}

fn supervise(
    command: &mut Command,
    timeout: Duration,
    mode: OutputMode,
) -> Result<Output, ProcessError> {
    if let Some(execute) = EXECUTOR.get() {
        return execute(command, timeout, mode);
    }
    supervise_blocking(command, timeout, mode)
}

pub(crate) fn supervise_blocking(
    command: &mut Command,
    timeout: Duration,
    mode: OutputMode,
) -> Result<Output, ProcessError> {
    let streams = match mode {
        OutputMode::Capture | OutputMode::Status => (Stdio::piped(), Stdio::piped()),
        OutputMode::Discard => (Stdio::null(), Stdio::null()),
        OutputMode::Diagnostic => (Stdio::null(), Stdio::piped()),
        OutputMode::TerminalStderr => (Stdio::piped(), Stdio::inherit()),
    };
    let limit = if matches!(mode, OutputMode::Status) {
        256 * 1024
    } else {
        OUTPUT_LIMIT
    };
    let mut child = command
        .stdout(streams.0)
        .stderr(streams.1)
        .process_group(0)
        .spawn()?;

    let pid = Pid::from_child(&child);
    let collected = (|| {
        if let Some(stdout) = &child.stdout {
            fcntl_setfl(stdout, fcntl_getfl(stdout)? | OFlags::NONBLOCK)?;
        }
        if let Some(stderr) = &child.stderr {
            fcntl_setfl(stderr, fcntl_getfl(stderr)? | OFlags::NONBLOCK)?;
        }

        let deadline = Instant::now() + timeout;
        let mut captured_stdout = Vec::new();
        let mut captured_stderr = Vec::new();
        let mut combined_size = 0;
        let (mut stdout_closed, mut stderr_closed, mut exited) =
            (child.stdout.is_none(), child.stderr.is_none(), false);

        loop {
            if Instant::now() >= deadline {
                return Err(ProcessError::Timeout);
            }
            if !stdout_closed && let Some(stdout) = &mut child.stdout {
                stdout_closed =
                    read_available(stdout, &mut captured_stdout, &mut combined_size, limit)?;
            }
            if !stderr_closed && let Some(stderr) = &mut child.stderr {
                if matches!(mode, OutputMode::Diagnostic) {
                    // Drain bursts promptly while retaining only the final bounded bytes.
                    for _ in 0..16 {
                        let mut buffer = [0; 4096];
                        match stderr.read(&mut buffer) {
                            Ok(0) => {
                                stderr_closed = true;
                                break;
                            }
                            Ok(count) => {
                                captured_stderr.extend_from_slice(&buffer[..count]);
                                let excess = captured_stderr.len().saturating_sub(OUTPUT_LIMIT);
                                captured_stderr.drain(..excess);
                            }
                            Err(error)
                                if matches!(
                                    error.kind(),
                                    io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                                ) =>
                            {
                                break;
                            }
                            Err(error) => return Err(error.into()),
                        }
                    }
                } else {
                    stderr_closed =
                        read_available(stderr, &mut captured_stderr, &mut combined_size, limit)?;
                }
            }
            if !exited {
                exited = waitid(
                    WaitId::Pid(pid),
                    WaitIdOptions::EXITED | WaitIdOptions::NOHANG | WaitIdOptions::NOWAIT,
                )?
                .is_some();
            }
            if exited && stdout_closed && stderr_closed {
                return Ok((captured_stdout, captured_stderr));
            }
            thread::sleep(
                Duration::from_millis(10).min(deadline.saturating_duration_since(Instant::now())),
            );
        }
    })();

    // Descendants may still own pipes. Keep the leader unreaped until group
    // cleanup so the operating system cannot reuse its process-group identifier.
    let status = match kill_process_group(pid, Signal::KILL) {
        Ok(()) | Err(rustix::io::Errno::SRCH) => child.wait()?,
        Err(rustix::io::Errno::PERM) => {
            // Darwin excludes zombies from group signalling and returns EPERM
            // for a zombie-only group. Require its disappearance after reaping;
            // permission failures involving a surviving process must still fail.
            let exited = waitid(
                WaitId::Pid(pid),
                WaitIdOptions::EXITED | WaitIdOptions::NOHANG | WaitIdOptions::NOWAIT,
            )?
            .is_some();
            if !exited {
                return Err(rustix::io::Errno::PERM.into());
            }
            let status = child.wait()?;
            // The identifier may now be reused, so only probe, never signal.
            if test_kill_process_group(pid) != Err(rustix::io::Errno::SRCH) {
                return Err(rustix::io::Errno::PERM.into());
            }
            status
        }
        Err(error) => return Err(error.into()),
    };
    let (stdout, stderr) = collected?;
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_a_successful_command() {
        let result = run(Path::new("/bin/echo"), &["fixture"], Duration::from_secs(2)).unwrap();
        assert!(result.status.success());
        assert_eq!(result.stdout, b"fixture\n");
    }

    #[test]
    fn memory_input_reader_closes_on_spawn_failure_and_timeout() {
        let input = vec![b'x'; 16 * 1024];
        let mut missing = Command::new("/nonexistent/homelab-fixture");
        assert!(matches!(
            capture_input(&mut missing, &input, Duration::from_secs(1)),
            Err(ProcessError::Io(_))
        ));
        let mut sleeping = Command::new("/bin/sleep");
        sleeping.arg("20");
        assert!(matches!(
            capture_input(&mut sleeping, &input, Duration::from_millis(30)),
            Err(ProcessError::Timeout)
        ));
    }

    #[test]
    fn times_out_a_running_command() {
        let result = run(Path::new("/bin/sleep"), &["20"], Duration::from_millis(30));
        assert!(matches!(result, Err(ProcessError::Timeout)));
    }

    #[test]
    fn discarded_output_does_not_bypass_the_deadline() {
        let mut command = Command::new("/bin/sleep");
        command.arg("20").stdin(Stdio::null());
        let result = run_silent(&mut command, Duration::from_millis(30));
        assert!(matches!(result, Err(ProcessError::Timeout)));
    }

    #[test]
    fn diagnostics_discard_stdout_and_bound_stderr_without_changing_exit_status() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "i=0; while [ $i -lt 3000 ]; do printf 'stdout-ignored-12345678901234567890\n'; printf 'diagnostic-noise-12345678901234567890\n' >&2; i=$((i+1)); done; printf 'final-failure-cause\n' >&2; exit 7"]);
        let output = run_diagnostic(&mut command, Duration::from_secs(10)).unwrap();
        assert_eq!(output.status.code(), Some(7));
        assert!(output.stdout.is_empty());
        assert!(output.stderr.len() <= OUTPUT_LIMIT);
        assert!(output.stderr.ends_with(b"final-failure-cause\n"));
    }

    #[test]
    fn diagnostic_mode_still_enforces_timeout() {
        let mut command = Command::new("/bin/sleep");
        command.arg("20");
        assert!(matches!(
            run_diagnostic(&mut command, Duration::from_millis(30)),
            Err(ProcessError::Timeout)
        ));
    }

    #[test]
    fn rejects_excessive_output() {
        let result = run(Path::new("/usr/bin/yes"), &[], Duration::from_secs(2));
        assert!(
            matches!(result, Err(ProcessError::ExcessiveOutput)),
            "{result:?}"
        );
    }

    #[test]
    fn timeout_terminates_descendant_after_leader_exits() {
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("descendant");
        let marker = directory.path().join("child.lock");
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/descendant.rs");
        let build = Command::new("rustc")
            .arg(source)
            .arg("-o")
            .arg(&executable)
            .output()
            .unwrap();
        assert!(
            build.status.success(),
            "{}",
            String::from_utf8_lossy(&build.stderr)
        );
        let result = run(
            &executable,
            &[marker.to_str().unwrap()],
            Duration::from_millis(500),
        );
        assert!(matches!(result, Err(ProcessError::Timeout)), "{result:?}");
        assert_eq!(std::fs::read_to_string(&marker).unwrap(), "ready");
        let lock = std::fs::File::open(marker).unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            match rustix::fs::flock(&lock, rustix::fs::FlockOperation::NonBlockingLockExclusive) {
                Ok(()) => break,
                Err(rustix::io::Errno::WOULDBLOCK) => {}
                Err(error) => panic!("Could not inspect the fixture lock: {error}"),
            }
            assert!(
                Instant::now() < deadline,
                "The fixture descendant survived cleanup."
            );
            thread::sleep(Duration::from_millis(10));
        }
    }
}
