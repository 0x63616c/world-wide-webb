fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    assert_eq!(args[0], "api");
    assert_eq!(args[3], format!("repos/example/config/contents/projects/homelab/homelab.json?ref={}", "a".repeat(40)));
    println!("{{\"schema\":1,\"hosts\":{{\"removed-from-main\":{{\"adminUser\":\"original-admin\",\"adminUID\":501,\"authorizedKeys\":[],\"activationReady\":true,\"services\":[]}}}},\"tailscale\":null}}");
}
