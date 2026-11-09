{ pkgs }:
pkgs.rustPlatform.buildRustPackage {
  pname = "homelab-host-ops";
  version = "0.1.0";
  src = pkgs.lib.fileset.toSource {
    root = ../.;
    fileset = pkgs.lib.fileset.unions [
      ../host/Cargo.toml ../host/Cargo.lock ../host/src ../host/tests
      ../cli/Cargo.toml ../cli/build.rs ../cli/src
    ];
  };
  cargoRoot = "host";
  buildAndTestSubdir = "host";
  cargoLock = {
    lockFile = ../host/Cargo.lock;
  };
  nativeCheckInputs = [ pkgs.nodejs ];
  preCheck = "node --check host/src/probes/control-center.mjs";
}
