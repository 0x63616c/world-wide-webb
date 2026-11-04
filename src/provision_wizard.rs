//! Local credential preparation. Deployment remains a separate reviewed-artifact step.
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crossterm::event::{
    self, DisableBracketedPaste, EnableBracketedPaste, Event, KeyCode, KeyModifiers,
};
use crossterm::execute;

use crate::provisioning::{BaseTokens, Session, Tools};
use crate::setup_wizard::{Outcome, choose, draw, review, usable_size};
use crate::tui::footer;
use crate::{config, tailscale_oauth};

const TAILSCALE_URL: &str = "https://login.tailscale.com/admin/settings/keys";
const GITHUB_URL: &str = "https://github.com/settings/personal-access-tokens/new";

pub(crate) fn state_directory() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join(".local/state/homelab/provisioning"))
}

fn stopped() -> Outcome {
    Outcome { completed: false, lines: vec!["Credential preparation stopped. No deployment was started.".into(), "Any generated age identities remain in private local storage; they were not replaced or removed.".into()] }
}

struct PasteMode;
impl PasteMode {
    fn enter() -> io::Result<Self> {
        execute!(io::stdout(), EnableBracketedPaste)?;
        Ok(Self)
    }
}
impl Drop for PasteMode {
    fn drop(&mut self) {
        let _ = execute!(io::stdout(), DisableBracketedPaste);
    }
}

// Token contents never enter a render model or a diagnostic.
#[derive(Default)]
struct TokenInput {
    value: String,
    invalid: bool,
}
impl TokenInput {
    fn append(&mut self, value: &str) {
        if value.is_empty()
            || value.chars().any(|c| !c.is_ascii_graphic())
            || self.value.len() + value.len() > 4096
        {
            self.invalid = true;
        } else {
            self.value.push_str(value);
            self.invalid = false;
        }
    }
    fn lines(&self, title: &str) -> Vec<String> {
        vec![
            title.into(),
            "Paste the token; its value stays hidden.".into(),
            if self.value.is_empty() {
                "> [empty]"
            } else {
                "> [hidden]"
            }
            .into(),
            if self.invalid {
                "! Use one token without whitespace."
            } else {
                "Ctrl-U clears · Backspace edits"
            }
            .into(),
        ]
    }
}

fn token(title: &str) -> io::Result<Option<String>> {
    let _paste = PasteMode::enter()?;
    let mut input = TokenInput::default();
    loop {
        draw(&input.lines(title), 0, &footer("Continue", "Esc back"))?;
        match event::read()? {
            Event::Paste(value) => input.append(&value),
            Event::Key(key) if key.kind != event::KeyEventKind::Release => {
                if key.modifiers.contains(KeyModifiers::CONTROL) {
                    match key.code {
                        KeyCode::Char('c') => return Ok(None),
                        KeyCode::Char('u') => {
                            input.value.clear();
                            input.invalid = false;
                        }
                        _ => {}
                    }
                    continue;
                }
                match key.code {
                    KeyCode::Esc => return Ok(None),
                    KeyCode::Enter
                        if !input.value.is_empty() && !input.invalid && usable_size()? =>
                    {
                        return Ok(Some(input.value));
                    }
                    KeyCode::Backspace => {
                        input.value.pop();
                        input.invalid = false;
                    }
                    KeyCode::Char(c) => input.append(&c.to_string()),
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

fn guide(lines: &[String], url: &str) -> io::Result<bool> {
    match choose(lines, &["Open token page", "I have the token"])? {
        None => Ok(false),
        Some(1) => Ok(true),
        _ => {
            // Only fixed issuer URLs are passed to the system browser.
            let mut command = Command::new("/usr/bin/open");
            command.arg(url).stdin(Stdio::null());
            let opened =
                crate::process::run_silent(&mut command, std::time::Duration::from_secs(10))
                    .is_ok_and(|status| status.success());
            if !opened {
                return review(&["Open your browser".into(), url.into()], "Continue");
            }
            Ok(true)
        }
    }
}

fn tailscale_guide(host: &str, tag: &str) -> Vec<String> {
    vec![
        "Create Tailscale auth key".into(),
        format!("Host: {host}"),
        format!("Tag: {tag} (policy allowed)"),
        "Reusable: OFF · Ephemeral: OFF".into(),
        "Expiry: short".into(),
        "Pre-approve if approval required".into(),
    ]
}

fn github_guide(host: &str, repository: &str) -> Vec<String> {
    vec![
        "Create GitHub read token".into(),
        format!("Host: {host}"),
        format!("Fine-grained · {repository} only"),
        "Contents: read · Actions: read".into(),
        "Set expiry; owner approval if needed".into(),
    ]
}

pub(crate) fn launch(
    root: &Path,
    host: &str,
    workspace: &config::Workspace,
) -> io::Result<Outcome> {
    let Some(tailscale) = workspace.manifest.tailscale.as_ref() else {
        return Ok(Outcome {
            completed: false,
            lines: vec![
                "Credential preparation needs Tailscale settings.".into(),
                "Add the enrollment tag to the private repository manifest, then reopen setup."
                    .into(),
            ],
        });
    };
    draw(
        &[
            "Preparing credentials".into(),
            format!("Host: {host}"),
            "Creating or reopening private age identities.".into(),
        ],
        0,
        "Please wait",
    )?;
    let result = (|| {
        let tools = Tools::discover()?;
        Session::open(host, &workspace.repository, root, &tools)
    })();
    let mut session = match result {
        Ok(session) => session,
        Err(error) => {
            return Ok(Outcome {
                completed: false,
                lines: vec![
                    "Credential preparation blocked".into(),
                    error.to_string(),
                    error.next_action().into(),
                ],
            });
        }
    };
    let details = session.details();
    if !details.completed {
        if !review(
            &[
                "Back up age identities".into(),
                "Save both private files in your password manager before continuing:".into(),
                format!("Host: {}", details.host_key_path.display()),
                format!("Recovery: {}", details.recovery_key_path.display()),
                String::new(),
                "Recovery stays off homelab hosts.".into(),
                "Lose both keys → lose decryption.".into(),
            ],
            "I saved both identity files",
        )? {
            return Ok(stopped());
        }
        let oauth = if let Some(reference) = tailscale.oauth.as_ref() {
            let selected = choose(&[
                "Tailscale enrollment key".into(),
                format!("Host: {host}"),
                format!("Tag: {}", tailscale.tag),
                format!("1Password: {} / {}", reference.vault, reference.item),
                "Create one single-use, non-ephemeral key after final approval. Valid for one day.".into(),
            ], &["Create with 1Password", "Paste an auth key"])?;
            match selected {
                None => return Ok(stopped()),
                Some(0) => Some(reference),
                _ => None,
            }
        } else {
            None
        };
        let manual_key = if oauth.is_none() {
            if !guide(&tailscale_guide(host, &tailscale.tag), TAILSCALE_URL)? {
                return Ok(stopped());
            }
            let Some(value) = token(&format!("{host}: Tailscale key"))? else {
                return Ok(stopped());
            };
            Some(value)
        } else {
            None
        };
        if !guide(&github_guide(host, &workspace.repository), GITHUB_URL)? {
            return Ok(stopped());
        }
        let Some(github_read) = token(&format!("{host}: GitHub token"))? else {
            return Ok(stopped());
        };
        if !review(
            &[
                "Review encryption".into(),
                format!("Configuration: {host}"),
                format!("Host recipient: {}", details.host_recipient),
                format!("Recovery recipient: {}", details.recovery_recipient),
                String::new(),
                "Encrypted fields".into(),
                "• tailscale-auth-key".into(),
                "• github-read-token".into(),
                String::new(),
                "Bootstrap token copy".into(),
                "GitHub token: plaintext, mode 0600,".into(),
                "outside Git on this Mac.".into(),
                "Review files contain no raw tokens.".into(),
                if oauth.is_some() {
                    "Approval also creates a single-use Tailscale key valid for one day. Complete review/deployment before expiry.".into()
                } else {
                    "No issuer key will be created.".into()
                },
            ],
            "Encrypt configuration",
        )? {
            return Ok(stopped());
        }
        let issued = if let Some(reference) = oauth {
            draw(
                &[
                    "Requesting enrollment key".into(),
                    format!("Host: {host}"),
                    "Unlock 1Password and approve access if asked.".into(),
                ],
                0,
                "Please wait",
            )?;
            if let Err(error) = session.claim_enrollment() {
                return Ok(Outcome {
                    completed: false,
                    lines: vec![error.to_string(), error.next_action().into()],
                });
            }
            match tailscale_oauth::discover_op()
                .and_then(|op| tailscale_oauth::create_auth_key(&op, reference, &tailscale.tag))
            {
                Ok(key) => Some(key),
                Err(error) => {
                    let mut lines = vec![error.to_string(), error.next_action().into()];
                    if error != tailscale_oauth::Error::IssuanceUnknown {
                        if let Err(cleanup) = session.finish_enrollment() {
                            lines.push(cleanup.to_string());
                        }
                    } else {
                        lines.push("An enrollment-attempt marker blocks retry until this attempt is inspected.".into());
                    }
                    return Ok(Outcome {
                        completed: false,
                        lines,
                    });
                }
            }
        } else {
            None
        };
        let tailscale_auth = match (&issued, manual_key) {
            (Some(key), _) => key.secret().to_owned(),
            (_, Some(key)) => key,
            _ => unreachable!("a credential source was selected"),
        };
        if let Err(error) = session.encrypt(BaseTokens {
            github_read,
            tailscale_auth,
        }) {
            let mut lines = vec![
                "Encryption blocked".into(),
                error.to_string(),
                error.next_action().into(),
            ];
            if let Some(key) = issued {
                match key.revoke() {
                    Ok(()) => {
                        lines.push("The generated enrollment key was revoked. The attempt marker remains; inspect any saved ciphertext before retrying.".into());
                        // Save can fail after publishing completed state. Keep the
                        // attempt marker so revoked ciphertext cannot be reused.
                    }
                    Err(error) => {
                        lines.push(error.to_string());
                        lines.push(format!("Key ID: {}", key.id()));
                        lines.push(error.next_action().into());
                    }
                }
            }
            return Ok(Outcome {
                completed: false,
                lines,
            });
        }
        if issued.is_some()
            && let Err(error) = session.finish_enrollment()
        {
            return Ok(Outcome {completed:false,lines:vec!["Encrypted files were saved, but the enrollment attempt marker needs inspection.".into(),error.to_string()]});
        }
    }
    Ok(Outcome {
        completed: true,
        lines: vec![
            "Encrypted configuration prepared. Nothing was deployed.".into(),
            "Encryption was checked locally. GitHub permissions and manually supplied auth keys were not verified with their issuers.".into(),
            format!("Review files: {}", details.review_directory.display()),
            "Review and merge ciphertext, public recipients and host readiness in your private repository.".into(),
            "Return to Review & set up. The CLI reads the merged revision and reuses private key/token paths. OAuth enrollment keys expire after one day.".into(),
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn issuer_scope_and_key_settings_fit_the_minimum_terminal() {
        for lines in [
            tailscale_guide("example-host", "tag:lab"),
            github_guide("example-host", "example/config"),
        ] {
            assert!(crate::tui::wrap(&lines[1..], 36).len() <= 5);
        }
    }

    #[test]
    #[ignore = "visual QA harness; exits without opening issuer URLs"]
    fn render_preview() {
        let _terminal = crate::tui::Terminal::enter().unwrap();
        let lines = if std::env::var("HOMELAB_PREVIEW").unwrap() == "tailscale" {
            tailscale_guide("example-host", "tag:lab")
        } else {
            github_guide("example-host", "example/config")
        };
        guide(&lines, "https://example.invalid").unwrap();
    }

    #[test]
    fn pasted_tokens_never_appear_in_rendered_success_or_error_state() {
        let mut input = TokenInput::default();
        input.append("secret-sentinel");
        let lines = input.lines("GitHub read token").join("\n");
        assert!(lines.contains("[hidden]"));
        assert!(!lines.contains("secret-sentinel"));
        input.append("\nsecond-secret");
        assert!(input.invalid);
        assert_eq!(input.value, "secret-sentinel");
        assert!(
            !input
                .lines("GitHub read token")
                .join("\n")
                .contains("secret-sentinel")
        );
    }
    #[test]
    fn hidden_token_terminal_child() {
        if std::env::var_os("HOMELAB_TOKEN_TEST_CHILD").is_none() {
            return;
        }
        let terminal = crate::tui::Terminal::enter().unwrap();
        let result = token("Synthetic token input").unwrap();
        drop(terminal);
        println!(
            "{}",
            if result.is_some() {
                "TOKEN_ACCEPTED"
            } else {
                "TOKEN_CANCELLED"
            }
        );
    }

    #[test]
    fn real_terminal_never_echoes_token_on_submit_invalid_paste_or_cancel() {
        use rustix::fs::{Mode, OFlags, fcntl_setfl, open};
        use rustix::io::{FdFlags, fcntl_setfd};
        use rustix::pty::{OpenptFlags, grantpt, openpt, ptsname, unlockpt};
        use rustix::termios::{Winsize, tcgetattr, tcsetwinsize};
        use std::fs::File;
        use std::io::{Read, Write};
        use std::process::Stdio;
        use std::time::{Duration, Instant};
        for cancel in [false, true] {
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
                    ws_row: 12,
                    ws_col: 40,
                    ws_xpixel: 0,
                    ws_ypixel: 0,
                },
            )
            .unwrap();
            let original = tcgetattr(&slave).unwrap().local_modes;
            let mut child = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "provision_wizard::tests::hidden_token_terminal_child",
                    "--nocapture",
                ])
                .env("HOMELAB_TOKEN_TEST_CHILD", "1")
                .env("TERM", "xterm-256color")
                .stdin(Stdio::from(slave.try_clone().unwrap()))
                .stdout(Stdio::from(slave.try_clone().unwrap()))
                .stderr(Stdio::from(slave.try_clone().unwrap()))
                .spawn()
                .unwrap();
            fcntl_setfl(&master, OFlags::NONBLOCK).unwrap();
            let mut master = File::from(master);
            let mut output = String::new();
            let mut wait_for = |needle: &str, master: &mut File| {
                let deadline = Instant::now() + Duration::from_secs(10);
                loop {
                    let mut bytes = [0; 4096];
                    match master.read(&mut bytes) {
                        Ok(count) => output.push_str(&String::from_utf8_lossy(&bytes[..count])),
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
                        Err(error) => panic!("terminal read failed: {error}"),
                    }
                    assert!(!output.contains("TOKEN_SENTINEL") && !output.contains("BAD_SENTINEL"));
                    if output.contains(needle) {
                        break;
                    }
                    assert!(
                        Instant::now() < deadline,
                        "terminal prompt missing: {needle}"
                    );
                    std::thread::sleep(Duration::from_millis(10));
                }
            };
            wait_for("Synthetic token input", &mut master);
            master
                .write_all(b"\x1b[200~TOKEN_SENTINEL\x1b[201~")
                .unwrap();
            wait_for("[hidden]", &mut master);
            master
                .write_all(b"\x1b[200~BAD_SENTINEL\n\x1b[201~")
                .unwrap();
            wait_for("without whitespace", &mut master);
            if cancel {
                master.write_all(b"\x03").unwrap();
            } else {
                master
                    .write_all(b"\x15\x1b[200~TOKEN_SENTINEL\x1b[201~\r")
                    .unwrap();
            }
            wait_for(
                if cancel {
                    "TOKEN_CANCELLED"
                } else {
                    "TOKEN_ACCEPTED"
                },
                &mut master,
            );
            assert!(child.wait().unwrap().success());
            assert_eq!(tcgetattr(&slave).unwrap().local_modes, original);
        }
    }
}
