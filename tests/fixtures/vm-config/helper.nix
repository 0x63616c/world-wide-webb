{ pkgs }:
let
  fixture = builtins.fromJSON (builtins.readFile ./fixture.json);
  source = assert builtins.match "[0-9a-f]{40}" fixture.helperRevision != null; builtins.fetchGit {
    url = "https://github.com/0x63616c/homelab-cli.git";
    rev = fixture.helperRevision;
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
