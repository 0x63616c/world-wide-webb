use std::env;

fn main() {
    println!("cargo:rerun-if-env-changed=HOMELAB_DEV_REVISION");
    println!("cargo:rerun-if-changed=build.rs");
    let version = env::var("CARGO_PKG_VERSION").unwrap();
    let version = if env::var_os("CARGO_FEATURE_LOCAL_DEV").is_some() {
        let revision = env::var("HOMELAB_DEV_REVISION")
            .expect("Use `just dev` to build with the current Git revision");
        let hash = revision.strip_suffix("-dirty").unwrap_or(&revision);
        assert!(
            (8..=40).contains(&hash.len()) && hash.bytes().all(|byte| byte.is_ascii_hexdigit()),
            "The development revision must be a Git commit hash"
        );
        format!("{version}-dev(#{revision})")
    } else {
        version
    };
    println!("cargo:rustc-env=HOMELAB_BUILD_VERSION={version}");
}
