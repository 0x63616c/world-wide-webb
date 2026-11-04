{ pkgs }:
pkgs.rustPlatform.buildRustPackage {
  pname = "homelab";
  version = "0.1.2";

  src = pkgs.lib.fileset.toSource {
    root = ../client;
    fileset = pkgs.lib.fileset.unions [
      ../client/Cargo.toml
      ../client/Cargo.lock
      ../client/src
      ../client/tests
    ];
  };
  cargoLock.lockFile = ../client/Cargo.lock;
  nativeCheckInputs = [ pkgs.shellcheck pkgs.git pkgs.nodejs pkgs.openssh ];
  preCheck = ''
    shellcheck src/probe.sh
    shellcheck src/git-askpass.sh
    shellcheck src/remote/*.sh
    shellcheck src/first-access/*.sh
    node --check src/probes/control-center.mjs
  '';
  meta.mainProgram = "homelab";
}
