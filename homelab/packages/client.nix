{ pkgs }:
let
  # The private service crate and installed bootstrap share one public revision.
  dependency = (builtins.fromTOML (builtins.readFile ../host/Cargo.toml)).dependencies.homelab-client;
  source = builtins.fetchGit { url = dependency.git; rev = dependency.rev; };
in pkgs.rustPlatform.buildRustPackage {
  pname = "homelab";
  version = (builtins.fromTOML (builtins.readFile (source + "/Cargo.toml"))).package.version;

  src = source;
  cargoLock.lockFile = source + "/Cargo.lock";
  nativeBuildInputs = [ pkgs.makeWrapper ];
  nativeCheckInputs = [ pkgs.shellcheck pkgs.git pkgs.openssh pkgs.age pkgs.sops ];
  postInstall = ''
    wrapProgram $out/bin/homelab --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.age pkgs.sops ]}
  '';
  preCheck = ''
    shellcheck src/probe.sh
    shellcheck src/remote/*.sh
    shellcheck src/first-access/*.sh
  '';
  meta.mainProgram = "homelab";
}
