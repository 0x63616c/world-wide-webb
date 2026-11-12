{ pkgs }:
let
  source = pkgs.lib.fileset.toSource {
    root = ../.;
    fileset = pkgs.lib.fileset.unions [
      ../cli/Cargo.toml
      ../cli/Cargo.lock
      ../cli/build.rs
      ../cli/src
      ../cli/tests
      ../cli/schema
      ../cli/examples
      ../process/Cargo.toml
      ../process/src
    ];
  };
in
pkgs.rustPlatform.buildRustPackage {
  pname = "homelab";
  version = (builtins.fromTOML (builtins.readFile ../cli/Cargo.toml)).package.version;
  src = source;
  cargoRoot = "cli";
  buildAndTestSubdir = "cli";
  cargoLock.lockFile = ../cli/Cargo.lock;
  nativeBuildInputs = [ pkgs.makeWrapper ];
  nativeCheckInputs = [
    pkgs.shellcheck
    pkgs.git
    pkgs.openssh
    pkgs.age
    pkgs.sops
  ];
  postInstall = ''
    wrapProgram $out/bin/homelab --prefix PATH : ${
      pkgs.lib.makeBinPath [
        pkgs.age
        pkgs.sops
      ]
    }
  '';
  preCheck = ''
    shellcheck cli/src/probe.sh
    shellcheck cli/src/remote/*.sh
    shellcheck cli/src/first-access/*.sh
  '';
  meta.mainProgram = "homelab";
}
