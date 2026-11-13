{ pkgs }:

pkgs.stdenvNoCC.mkDerivation {
  pname = "rex";
  version = "0.1.0-preview.18-1956";
  # Pin the immutable enclosure from the official preview appcast, not latest.dmg.
  # Switch to the official stable enclosure when upstream publishes that channel.
  src = pkgs.fetchurl {
    url = "https://blob.superlogical.com/public/rex-app/preview/Rex-0.1.0-1956.dmg";
    hash = "sha256-HyRgH0lj41d+34NngLIdBQXiJ66YHVE4ZZ/H9ouPum4=";
  };
  nativeBuildInputs = [ pkgs.undmg ];
  nativeInstallCheckInputs = [ pkgs.python3 ];
  sourceRoot = ".";
  dontConfigure = true;
  dontBuild = true;
  # Keep Apple's bundle layout and upstream signatures intact.
  dontFixup = true;
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/libexec" "$out/bin"
    cp -R "Rex Beta.app/Contents/Helpers/Rex Server.rex" "$out/libexec/"
    ln -s "$out/libexec/Rex Server.rex/Contents/MacOS/rex" "$out/bin/rex"
    runHook postInstall
  '';
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    # Executing a writable signed bundle lets macOS attach app-management
    # metadata, which prevents Nix from finalizing that output. Exercise an
    # identical disposable copy; leave the store output untouched until sealed.
    checkRoot="$(mktemp -d)"
    cp -R "$out/libexec/Rex Server.rex" "$checkRoot/"
    checkBinary="$checkRoot/Rex Server.rex/Contents/MacOS/rex"
    "$checkBinary" version | grep -Fx 'rex 0.1.0-preview.18'
    /usr/bin/codesign --verify --deep --strict "$checkRoot/Rex Server.rex"
    python3 ${../tests/check_rex_server.py} "$checkBinary"
    runHook postInstallCheck
  '';
  meta = {
    description = "Rex terminal server and CLI from the official signed Mac release";
    homepage = "https://www.superlogical.com/rex/docs";
    license = pkgs.lib.licenses.unfree;
    platforms = [ "aarch64-darwin" ];
    mainProgram = "rex";
  };
}
