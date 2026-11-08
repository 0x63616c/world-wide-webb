use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::process;

fn main() {
    let executable = env::current_exe().expect("fixture executable path");
    let directory = executable.parent().expect("fixture directory");
    let arguments: Vec<_> = env::args().skip(1).collect();
    let mut calls = OpenOptions::new()
        .create(true)
        .append(true)
        .open(directory.join("calls"))
        .expect("fixture call log");
    writeln!(calls, "{}", arguments.join(" ")).expect("record invocation");

    match arguments.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["-g", "cap"] => print!("{}", fs::read_to_string(directory.join("capabilities")).unwrap()),
        ["-g", "custom"] => print!("{}", fs::read_to_string(directory.join("settings")).unwrap()),
        ["-c", ..] => {
            if directory.join("fail-apply").exists() {
                process::exit(1);
            }
            fs::copy(directory.join("after"), directory.join("settings")).unwrap();
        }
        _ => process::exit(2),
    }
}
