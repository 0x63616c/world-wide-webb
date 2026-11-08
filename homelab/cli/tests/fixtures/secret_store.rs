use std::fs;
use std::path::PathBuf;

fn main() {
    let root = PathBuf::from(std::env::args().next().unwrap())
        .parent()
        .unwrap()
        .to_owned();
    let args: Vec<_> = std::env::args().skip(1).collect();
    assert!(!args.iter().any(|arg| arg.contains("AGE-SECRET")));
    assert!(args.windows(2).any(|args| args == ["--format", "json"]));
    match (args[0].as_str(), args[1].as_str()) {
        ("vault", "get") => println!("{{\"id\":\"aaaaaaaaaaaaaaaaaaaaaaaaaa\"}}"),
        ("item", "list") => {
            if root.join("created").exists() {
                let tag = &args[args.iter().position(|arg| arg == "--tags").unwrap() + 1];
                println!(
                    "{}",
                    fs::read_to_string(root.join("listing"))
                        .unwrap()
                        .replace("TAG", tag)
                );
            } else {
                println!("[]");
            }
        }
        ("item", "create") => {
            use std::os::unix::fs::PermissionsExt;
            assert!(!args.iter().any(|arg| arg == "--category"));
            let template = &args[args.iter().position(|arg| arg == "--template").unwrap() + 1];
            assert_eq!(
                fs::metadata(template).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert!(!root.join("created").exists());
            let input = fs::read_to_string(template).unwrap();
            fs::write(root.join("template-path"), template).unwrap();
            assert!(input.contains("AGE-SECRET-KEY-1SYNTHETIC"));
            assert!(input.contains("CONCEALED"));
            assert!(input.contains("SECURE_NOTE"));
            fs::write(root.join("created"), "created").unwrap();
            println!("{{\"id\":\"bbbbbbbbbbbbbbbbbbbbbbbbbb\"}}");
        }
        ("item", "get") => print!("{}", fs::read_to_string(root.join("item")).unwrap()),
        _ => panic!("unexpected fixture operation"),
    }
}
