{ pkgs }:

# The locked nixpkgs has 0.18.2. Keep this native release aligned with the hub.
pkgs.stdenvNoCC.mkDerivation rec {
  pname = "beszel-agent";
  version = "0.21.1";
  src = pkgs.fetchurl {
    url = "https://github.com/henrygd/beszel/releases/download/v${version}/beszel-agent_darwin_arm64.tar.gz";
    hash = "sha256-kkYGX2gM2wryiFt79YdtxFt1QBnyyQ6yhVDPRduXjrg=";
  };
  sourceRoot = ".";
  dontConfigure = true;
  dontBuild = true;
  # The upstream CGO-free Mach-O needs no relocation; preserve its signature.
  dontFixup = true;
  installPhase = ''
    runHook preInstall
    install -Dm755 beszel-agent "$out/bin/beszel-agent"
    install -Dm644 LICENSE "$out/share/licenses/beszel-agent/LICENSE"
    runHook postInstall
  '';
  doInstallCheck = true;
  installCheckPhase = ''
    test "$("$out/bin/beszel-agent" --version)" = 'beszel-agent ${version}'
  '';
  meta = {
    description = "Native Beszel host monitoring agent";
    homepage = "https://beszel.dev";
    license = pkgs.lib.licenses.mit;
    platforms = [ "aarch64-darwin" ];
    mainProgram = "beszel-agent";
  };
}
