{ pkgs }:
pkgs.rustPlatform.buildRustPackage {
  pname = "homelab";
  version = "0.1.3";

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
  nativeBuildInputs = [ pkgs.makeWrapper ];
  nativeCheckInputs = [ pkgs.shellcheck pkgs.git pkgs.nodejs pkgs.openssh pkgs.age pkgs.sops ];
  postInstall = ''
    wrapProgram $out/bin/homelab --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.age pkgs.sops ]}
  '';
  preCheck = ''
    shellcheck src/probe.sh
    shellcheck src/git-askpass.sh
    shellcheck src/remote/*.sh
    shellcheck src/first-access/*.sh
    node --check src/probes/control-center.mjs
  '';
  meta.mainProgram = "homelab";
}
