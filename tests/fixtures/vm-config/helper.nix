{ pkgs }:
let
  source = builtins.fetchGit {
    url = "https://github.com/0x63616c/homelab-cli.git";
    rev = "6fd57fe68d72bd95d710a3bc76798e1c39a0ef4c";
  };
in pkgs.rustPlatform.buildRustPackage {
  pname = "homelab-vm-helper";
  version = (builtins.fromTOML (builtins.readFile (source + "/Cargo.toml"))).package.version;
  src = source;
  cargoLock.lockFile = source + "/Cargo.lock";
  cargoBuildFlags = [ "--bin" "homelab-host" ];
  # The public helper suite runs separately; this fixture tests its built target operations.
  doCheck = false;
}
