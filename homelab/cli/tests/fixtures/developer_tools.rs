use std::{env, fs, io::Write, process};

fn main() {
    let executable = env::current_exe().unwrap();
    let root = executable.parent().unwrap();
    let arguments: Vec<String> = env::args().skip(1).collect();
    writeln!(
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(root.join("calls"))
            .unwrap(),
        "{}",
        arguments.join(" ")
    )
    .unwrap();
    assert_eq!(env::var("LC_ALL").unwrap(), "C");
    assert!(env::var_os("SSH_AUTH_SOCK").is_none());
    let args: Vec<&str> = arguments.iter().map(String::as_str).collect();
    let success = match args.as_slice() {
        ["--print-path"] => root.join("selected").exists(),
        ["--version"] => root.join("installed").exists(),
        ["--list"] => {
            println!(
                "* Label: macOS 99\n* Label: Command Line Tools for Xcode 27.2-27.2\n\tTitle: Command Line Tools for Xcode 27.2, Version: 27.2, Size: 521120KiB, Recommended: YES,"
            );
            true
        }
        ["--install", "Command Line Tools for Xcode 27.2-27.2"] => {
            if root.join("fail").exists() {
                eprintln!("untrusted fixture diagnostics");
                false
            } else {
                fs::write(root.join("installed"), "").unwrap();
                true
            }
        }
        ["--pkg-info", "com.apple.pkg.CLTools_Executables"] => root.join("installed").exists(),
        ["--switch", "/Library/Developer/CommandLineTools"] => {
            fs::write(root.join("selected"), "").unwrap();
            true
        }
        _ => panic!("unexpected fixture arguments"),
    };
    process::exit(if success { 0 } else { 1 });
}
