use std::io::{self, Read};
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
pub(crate) enum ProcessError {
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
) -> Result<bool, ProcessError> {
    let mut buffer = [0; 4096];
    match pipe.read(&mut buffer) {
        Ok(0) => Ok(true),
        Ok(count) => {
            if *combined_size + count > OUTPUT_LIMIT {
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

pub(crate) fn capture(command: &mut Command, timeout: Duration) -> Result<Output, ProcessError> {
    supervise(command, timeout, OutputMode::Capture)
}

pub(crate) fn run_silent(
    command: &mut Command,
    timeout: Duration,
) -> Result<ExitStatus, ProcessError> {
    supervise(command, timeout, OutputMode::Discard).map(|output| output.status)
}

enum OutputMode {
    Capture,
    Discard,
}

fn supervise(
    command: &mut Command,
    timeout: Duration,
    mode: OutputMode,
) -> Result<Output, ProcessError> {
    let streams = match mode {
        OutputMode::Capture => (Stdio::piped(), Stdio::piped()),
        OutputMode::Discard => (Stdio::null(), Stdio::null()),
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
                stdout_closed = read_available(stdout, &mut captured_stdout, &mut combined_size)?;
            }
            if !stderr_closed && let Some(stderr) = &mut child.stderr {
                stderr_closed = read_available(stderr, &mut captured_stderr, &mut combined_size)?;
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
