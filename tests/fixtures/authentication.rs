use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
fn main() {
    let mode = std::env::args().nth(1).unwrap();
    let mut tty = OpenOptions::new().read(true).write(true).open("/dev/tty").unwrap();
    assert!(Command::new("/bin/stty").arg("-echo").stdin(tty.try_clone().unwrap()).status().unwrap().success());
    // Terminal control sequences must never escape the parser into the parent.
    write!(tty, "\x1b]52;c;Zml4dHVyZQ==\x07Password: ").unwrap();
    tty.flush().unwrap();
    let mut password = String::new();
    BufReader::new(tty.try_clone().unwrap()).read_line(&mut password).unwrap();
    assert_eq!(password.trim(), "dR?fixture-password");
    if mode == "retry" {
        write!(tty, "\nSorry, try again.\nPassword: ").unwrap();
        tty.flush().unwrap();
        password.clear();
        BufReader::new(tty.try_clone().unwrap()).read_line(&mut password).unwrap();
        assert_eq!(password.trim(), "dR?fixture-password");
        writeln!(tty, "\nBuilding configuration…").unwrap();
        tty.flush().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(400));
    }
    assert!(Command::new("/bin/stty").arg("echo").stdin(tty.try_clone().unwrap()).status().unwrap().success());
    if mode == "input" {
        let mut input = String::new();
        std::io::stdin().read_to_string(&mut input).unwrap();
        assert_eq!(input, "fixture-public-key\n");
    }
    if mode == "capture" {
        let mut input = String::new();
        std::io::stdin().read_to_string(&mut input).unwrap();
        assert!(input.is_empty());
        println!("{{\"verified\":true}}");
    }
    if mode.starts_with("failure") { writeln!(tty, "\nFixture command failed").unwrap(); std::process::exit(1); }
    let size = Command::new("/bin/stty").arg("size").stdin(File::open("/dev/tty").unwrap()).stderr(Stdio::null()).output().unwrap();
    writeln!(tty, "\nNative check complete {}", String::from_utf8_lossy(&size.stdout).trim()).unwrap();
}
