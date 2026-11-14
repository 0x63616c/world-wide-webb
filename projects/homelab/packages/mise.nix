{ pkgs }:
# Official Apple Silicon release: the repository's mise.toml needs a newer mise
# than nixpkgs ships. Hash from the release's SHASUMS256.txt.
pkgs.stdenvNoCC.mkDerivation {
  pname = "mise";
  version = "2026.11.7";
  src = pkgs.fetchurl {
    url = "https://github.com/jdx/mise/releases/download/v2026.11.7/mise-v2026.11.7-macos-arm64";
    sha256 = "0f7cb85b5c17208cb67088105bd1754c38314cb824cc97d109631b6df638f6fc";
  };
  dontUnpack = true;
  dontBuild = true;
  # Preserve the release binary's signature.
  dontFixup = true;
  installPhase = ''
    runHook preInstall
    install -Dm755 "$src" "$out/bin/mise"
    runHook postInstall
  '';
  doInstallCheck = true;
  nativeInstallCheckInputs = [
    pkgs.versionCheckHook
    pkgs.writableTmpDirAsHomeHook
  ];
  versionCheckKeepEnvironment = [ "HOME" ];
  versionCheckProgramArg = "--version";
  meta = {
    description = "mise for the coding account's shared repository tools";
    homepage = "https://mise.jdx.dev";
    license = pkgs.lib.licenses.mit;
    sourceProvenance = [ pkgs.lib.sourceTypes.binaryNativeCode ];
    platforms = [ "aarch64-darwin" ];
    mainProgram = "mise";
  };
}
