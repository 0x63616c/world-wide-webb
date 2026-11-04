{ pkgs }:
pkgs.rustPlatform.buildRustPackage {
  pname = "homelab-host-ops";
  version = "0.1.0";
  src = pkgs.lib.fileset.toSource {
    root = ../host;
    fileset = pkgs.lib.fileset.unions [ ../host/Cargo.toml ../host/Cargo.lock ../host/src ../host/tests ];
  };
  cargoLock = {
    lockFile = ../host/Cargo.lock;
    # Cargo.lock pins the public helper to one complete Git commit.
    allowBuiltinFetchGit = true;
  };
  nativeCheckInputs = [ pkgs.nodejs ];
  preCheck = "node --check src/probes/control-center.mjs";
}
