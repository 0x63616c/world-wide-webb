fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    assert_eq!(&args[..3], ["api", "--hostname", "github.com"]);
    let root = std::path::PathBuf::from(std::env::var_os("HOMELAB_RENEWAL_FIXTURE").unwrap());
    let revision =
        std::fs::read_to_string(root.join("main")).expect("claimed setup must not query GitHub");
    match args[3].as_str() {
        "repos/example/config/commits/main" => println!("{revision}"),
        path if path == format!("repos/example/config/contents/homelab.json?ref={revision}") => {
            println!(
                "{{\"schema\":1,\"hosts\":{{\"test-mac\":{{\"adminUser\":\"admin\",\"adminUID\":501,\"authorizedKeys\":[],\"activationReady\":true,\"services\":[]}}}}}}"
            );
        }
        path => panic!("unexpected synthetic endpoint: {path}"),
    }
}
