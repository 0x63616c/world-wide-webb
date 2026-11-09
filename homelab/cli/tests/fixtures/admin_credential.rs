use std::io::Read;
use std::os::unix::fs::FileTypeExt;
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    assert!(!std::env::vars().any(|(_, value)| value.contains("synthetic-stdin-password")));
    if args[1] == "get" {
        assert_eq!(
            args,
            [
                "item",
                "get",
                "bbbbbbbbbbbbbbbbbbbbbbbbbb",
                "--vault",
                "aaaaaaaaaaaaaaaaaaaaaaaaaa",
                "--format",
                "json",
                "--reveal"
            ]
        );
        println!(
            r#"{{"id":"bbbbbbbbbbbbbbbbbbbbbbbbbb","vault":{{"id":"aaaaaaaaaaaaaaaaaaaaaaaaaa"}},"category":"LOGIN","version":7,"notesPlain":"retained note","tags":["{}","manual-tag"],"fields":[{{"id":"repository","type":"STRING","value":"example/config"}},{{"id":"host","type":"STRING","value":"test-mac"}},{{"id":"username","type":"STRING","value":"admin"}},{{"id":"ssh-host-key","type":"STRING","value":"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}},{{"id":"password","type":"CONCEALED","value":"old-synthetic-password"}},{{"id":"extra","type":"CONCEALED","value":"retained-synthetic-secret"}}]}}"#,
            env!("HOMELAB_FIXTURE_TAG")
        );
        return;
    }
    assert!(
        std::fs::File::open("/dev/stdin")
            .unwrap()
            .metadata()
            .unwrap()
            .file_type()
            .is_fifo()
    );
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    match args[1].as_str() {
        "create" => {
            assert_eq!(
                args,
                [
                    "item",
                    "create",
                    "--vault",
                    "aaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "--format",
                    "json",
                    "-"
                ]
            );
            assert!(input.contains("synthetic-stdin-password"));
        }
        "edit" => {
            assert_eq!(
                args,
                [
                    "item",
                    "edit",
                    "bbbbbbbbbbbbbbbbbbbbbbbbbb",
                    "--vault",
                    "aaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "--format",
                    "json"
                ]
            );
            for preserved in [
                "retained note",
                "retained-synthetic-secret",
                "manual-tag",
                "\"version\":7",
                "updated-synthetic-password",
            ] {
                assert!(input.contains(preserved));
            }
            assert!(!input.contains("old-synthetic-password"));
        }
        _ => panic!("unexpected fixture command"),
    }
    assert!(input.contains("\"category\":\"LOGIN\""));
    assert!(input.contains("\"id\":\"password\""));
    println!(
        "{{\"id\":\"bbbbbbbbbbbbbbbbbbbbbbbbbb\",\"vault\":{{\"id\":\"aaaaaaaaaaaaaaaaaaaaaaaaaa\"}}}}"
    );
}
