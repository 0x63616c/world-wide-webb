use std::{env, fs, io::Write, process};

fn main() {
    let directory = env::current_exe().unwrap().parent().unwrap().to_owned();
    let arguments: Vec<String> = env::args().skip(1).collect();
    let mut calls = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(directory.join("calls"))
        .unwrap();
    writeln!(calls, "{}", arguments.join(" ")).unwrap();

    match arguments.first().map(String::as_str) {
        Some("status") => {
            print!("{}", fs::read_to_string(directory.join("status")).unwrap());
        }
        Some("set" | "up") => {
            if directory.join("fail-apply").exists() {
                eprintln!("fixture-sensitive-output");
                process::exit(1);
            }
            fs::copy(directory.join("after"), directory.join("status")).unwrap();
        }
        _ => process::exit(2),
    }
}
