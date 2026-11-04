//! Credentials are supplied only to Git's private askpass pipe.

use std::fs::File;
use std::io::{self, IsTerminal, Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::Path;

use rustix::fs::{Mode, OFlags, open};
use thiserror::Error;

#[derive(Debug, Error)]
#[error(
    "Git credentials could not be supplied securely. Check the private token file and retry bootstrap."
)]
pub struct Error;

fn token(path: &Path) -> Result<String, Error> {
    if !path.is_absolute() {
        return Err(Error);
    }
    let file = File::from(
        open(
            path,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| Error)?,
    );
    let metadata = file.metadata().map_err(|_| Error)?;
    if !metadata.is_file()
        || metadata.uid() != rustix::process::getuid().as_raw()
        || !matches!(metadata.mode() & 0o7777, 0o400 | 0o600)
        || metadata.len() == 0
        || metadata.len() > 4096
    {
        return Err(Error);
    }
    let mut value = String::new();
    file.take(4097)
        .read_to_string(&mut value)
        .map_err(|_| Error)?;
    let value = value.trim_end_matches(['\r', '\n']);
    if value.is_empty()
        || value.len() > 4096
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        return Err(Error);
    }
    Ok(value.to_owned())
}

pub fn respond(prompt: &str) -> Result<(), Error> {
    // A direct invocation must not accidentally print a token into a terminal.
    if io::stdout().is_terminal() {
        return Err(Error);
    }
    let response = match prompt {
        "Username for 'https://github.com': " => "x-access-token".to_owned(),
        "Password for 'https://x-access-token@github.com': " => {
            let path = std::env::var_os("HOMELAB_GITHUB_TOKEN_FILE").ok_or(Error)?;
            token(Path::new(&path))?
        }
        _ => return Err(Error),
    };
    writeln!(io::stdout().lock(), "{response}").map_err(|_| Error)
}
