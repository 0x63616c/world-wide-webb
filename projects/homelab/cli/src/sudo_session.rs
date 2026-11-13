//! Keep native authorization alive only while its setup session owns this guard.

use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

pub(crate) struct Authorization {
    stop: Sender<()>,
    worker: Option<JoinHandle<()>>,
}

pub(crate) fn validate(sudo: &Path, home: &Path) -> bool {
    crate::process::run_silent(
        Command::new(sudo)
            .args(["-n", "-v"])
            .env_clear()
            .env("HOME", home)
            .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
            .env("LC_ALL", "C")
            .stdin(Stdio::null()),
        Duration::from_secs(10),
    )
    .is_ok_and(|status| status.success())
}

impl Authorization {
    pub(crate) fn maintain(sudo: &Path, home: &Path) -> Self {
        let sudo = sudo.to_owned();
        let home = home.to_owned();
        let (stop, receiver) = mpsc::channel();
        let worker = thread::spawn(move || {
            while receiver.recv_timeout(Duration::from_secs(30))
                == Err(mpsc::RecvTimeoutError::Timeout)
            {
                if !validate(&sudo, &home) {
                    break;
                }
            }
        });
        Self {
            stop,
            worker: Some(worker),
        }
    }
}

impl Drop for Authorization {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
