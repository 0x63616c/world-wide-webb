{ lib, pkgs, ... }:
let
  # Xcode is installed by hand (Apple ID + 2FA); see docs/coding.md to bump it.
  # xcodes names the bundle with the full three-part version.
  xcodeVersion = "27.2.0";
  xcodeApp = "/Applications/Xcode-${xcodeVersion}.app";
  developer = "${xcodeApp}/Contents/Developer";
  xcodebuild = "${developer}/usr/bin/xcodebuild";
  iosRuntime = "iOS ${lib.versions.majorMinor xcodeVersion}";
  warn = message: "echo ${lib.escapeShellArg "warning: ${message}"} >&2";
in
{
  # Permanent host tools live here. The user's mutable shell/settings files are
  # owned by chezmoi's coding profile in 0x63616c/dotfiles; see docs/coding.md.
  # Git, curl and jq are already supplied by base.nix; do not install duplicates
  # through Homebrew or a user nix profile. Project runtimes belong in dev shells.
  environment.systemPackages = with pkgs; [
    zsh
    chezmoi
    gh
    ripgrep
    starship
    wtp
    xcodes
    zsh-autosuggestions
    zsh-syntax-highlighting
    (import ../packages/claude-code.nix { inherit pkgs; })
  ];
  # nix-darwin does not link arbitrary share directories into the system profile.
  environment.pathsToLink = [
    "/share/zsh-autosuggestions"
    "/share/zsh-syntax-highlighting"
  ];
  environment.shells = [ pkgs.zsh ];
  users.users.coding.shell = pkgs.zsh;
  # Activation never downloads Xcode or simulator platforms: both need the
  # owner's interactive Apple login. It keeps an installed Xcode selected and
  # ready, and reports anything missing without failing the host activation.
  system.activationScripts.postActivation.text = lib.mkAfter ''
    if [ -d ${lib.escapeShellArg xcodeApp} ]; then
      if [ "$(/usr/bin/xcode-select -p 2>/dev/null)" != ${lib.escapeShellArg developer} ]; then
        /usr/bin/xcode-select -s ${lib.escapeShellArg developer} \
          || ${warn "could not select ${xcodeApp}"}
      fi
      if ! ${lib.escapeShellArg xcodebuild} -license check >/dev/null 2>&1; then
        ${lib.escapeShellArg xcodebuild} -license accept \
          || ${warn "could not accept the Xcode ${xcodeVersion} license"}
      fi
      if ! ${lib.escapeShellArg xcodebuild} -checkFirstLaunchStatus >/dev/null 2>&1; then
        ${lib.escapeShellArg xcodebuild} -runFirstLaunch \
          || ${warn "xcodebuild -runFirstLaunch failed for Xcode ${xcodeVersion}"}
      fi
      if ! DEVELOPER_DIR=${lib.escapeShellArg developer} /usr/bin/xcrun simctl list runtimes 2>/dev/null \
        | /usr/bin/grep -q ${lib.escapeShellArg "^${iosRuntime} "}; then
        ${warn "${iosRuntime} Simulator runtime is missing; as admin run: sudo ${xcodebuild} -downloadPlatform iOS"}
      fi
    else
      ${warn "${xcodeApp} is missing; as admin run: sudo /run/current-system/sw/bin/xcodes install ${xcodeVersion} --directory /Applications --experimental-unxip --select && sudo xcodebuild -license accept && sudo xcodebuild -runFirstLaunch && sudo xcodebuild -downloadPlatform iOS"}
    fi
  '';
}
