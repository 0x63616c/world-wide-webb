{ pkgs }:
let
  runnerVersion = "2.338.2";
  # Official release checksum: https://github.com/actions/runner/releases/tag/v2.338.2
  runnerArchive = pkgs.fetchurl {
    url = "https://github.com/actions/runner/releases/download/v${runnerVersion}/actions-runner-osx-arm64-${runnerVersion}.tar.gz";
    sha256 = "25a065af409ffa317ab4d5a3b614dd15fc9c40f2172bc1b35a1b1258e919a388";
  };
in
pkgs.rustPlatform.buildRustPackage {
  pname = "homelab-runner";
  version = "0.1.0";
  src = pkgs.lib.cleanSourceWith {
    src = ../runner;
    filter = path: type:
      pkgs.lib.cleanSourceFilter path type
      && baseNameOf path != "target";
  };
  cargoLock.lockFile = ../runner/Cargo.lock;
  passthru = { inherit runnerVersion runnerArchive; };

  # This binary is copied into stock macOS guests, which have no Nix store.
  # Darwin's system libiconv provides the same libiconv.2 ABI as our SDK.
  postFixup = pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
    guest="$out/bin/homelab-runner-guest"
    guestDependencies="$(${pkgs.darwin.cctools}/bin/otool -L "$guest")"
    while read -r dependency _; do
      case "$dependency" in
        /nix/store/*/lib/libiconv.2.dylib)
          ${pkgs.darwin.cctools}/bin/install_name_tool \
            -change "$dependency" /usr/lib/libiconv.2.dylib "$guest"
          ;;
      esac
    done <<< "$guestDependencies"

    # Changing load commands invalidates the existing Mach-O signature.
    source ${pkgs.darwin.signingUtils}
    sign "$guest"
  '';

  doInstallCheck = pkgs.stdenv.hostPlatform.isDarwin;
  installCheckPhase = pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
    runHook preInstallCheck
    guest="$out/bin/homelab-runner-guest"
    guestLoadCommands="$(${pkgs.darwin.cctools}/bin/otool -l "$guest")"
    # Skip otool's filename header. Inspect all load commands, including rpaths,
    # so a new dependency cannot silently make the guest require Nix again.
    if printf '%s\n' "$guestLoadCommands" | tail -n +2 | grep -F '/nix/store/'; then
      echo "guest helper has a Nix store runtime dependency" >&2
      exit 1
    fi
    runHook postInstallCheck
  '';
  meta.mainProgram = "homelab-runner";
}
