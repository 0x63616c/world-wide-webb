{ pkgs }:
let
  source = builtins.fetchGit {
    url = "https://github.com/0x63616c/homelab-cli.git";
    rev = "14628dbba1e85a423c1358fe0c11bb5d0eb4b12f";
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
