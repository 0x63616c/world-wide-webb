use std::{env, fs, process::Command, thread, time::Duration};
use std::io::Write;

fn main() {
    let arguments: Vec<_> = env::args_os().collect();
    if arguments.len() == 3 {
        let mut lock = fs::File::create(&arguments[1]).unwrap();
        lock.lock().unwrap();
        lock.write_all(b"ready").unwrap();
        thread::sleep(Duration::from_secs(20));
        return;
    }
    let _child = Command::new(env::current_exe().unwrap())
        .arg(&arguments[1])
        .arg("child")
        .spawn()
        .unwrap();
    // Leaving the child attached to both pipes reproduces an exited SSH proxy.
}
