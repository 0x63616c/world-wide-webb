{ pkgs }:
# Native Apple Silicon release; no global nixpkgs update or mutable installer.
# Hash from the official versioned manifest.json's darwin-arm64 entry.
pkgs.stdenvNoCC.mkDerivation {
  pname = "claude-code";
  version = "2.1.323";
  src = pkgs.fetchurl {
    url = "https://downloads.claude.ai/claude-code-releases/2.1.323/darwin-arm64/claude";
    sha256 = "5432918d904a9b6afef7bb79d20df24d76052eabc1f41bceb84091d21f8889a7";
  };
  dontUnpack = true;
  dontBuild = true;
  # Preserve the native binary's signature and embedded Bun payload.
  dontFixup = true;
  nativeBuildInputs = [ pkgs.makeWrapper ];
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/libexec" "$out/bin"
    install -m755 "$src" "$out/libexec/claude"
    makeWrapper "$out/libexec/claude" "$out/bin/claude" \
      --set DISABLE_AUTOUPDATER 1 \
      --set USE_BUILTIN_RIPGREP 0 \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.ripgrep ]}
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
    description = "Claude Code native CLI for the coding account";
    homepage = "https://code.claude.com/docs/en/setup";
    license = pkgs.lib.licenses.unfree;
    sourceProvenance = [ pkgs.lib.sourceTypes.binaryNativeCode ];
    platforms = [ "aarch64-darwin" ];
    mainProgram = "claude";
  };
}
