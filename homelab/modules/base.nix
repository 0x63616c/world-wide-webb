{ config, lib, pkgs, ... }:
let cfg = config.homelab;
in {
  options.homelab = {
    adminUser = lib.mkOption { type = lib.types.str; };
    adminUID = lib.mkOption { type = lib.types.int; default = 501; };
  };
  config = {
    nixpkgs.hostPlatform = "aarch64-darwin";
    system.stateVersion = 6;
    system.primaryUser = cfg.adminUser;
    determinateNix.enable = true;
    # Adopt only the untouched default written by the pinned Determinate installer.
    # Any custom content still requires manual review before activation.
    environment.etc."nix/nix.custom.conf".knownSha256Hashes = [
      "3bd68ef979a42070a44f8d82c205cfd8e8cca425d91253ec2c10a88179bb34aa"
    ];
    nix.enable = false;
    time.timeZone = "America/Los_Angeles";
    # Let SSH sessions recognize Ghostty without installing its GUI application.
    environment.systemPackages = (with pkgs; [ git jq curl age sops ghostty-bin.terminfo ]) ++ [
      (import ../packages/client.nix { inherit pkgs; })
      (import ../packages/host.nix { inherit pkgs; })
    ];
    nix-homebrew = { enable = true; user = cfg.adminUser; autoMigrate = false; };
    homebrew = {
      enable = true;
      onActivation = { cleanup = "zap"; autoUpdate = false; upgrade = false; };
      brews = [ ];
      casks = [ ];
    };
    system.activationScripts.preActivation.text = lib.mkBefore ''
      ${lib.optionalString (cfg.authorizedKeys == []) ''
        echo 'Activation blocked: configure an administrator SSH public key first.' >&2
        exit 1
      ''}
      if [ "$(/usr/bin/id -u ${lib.escapeShellArg cfg.adminUser})" != '${toString cfg.adminUID}' ]; then
        echo 'Existing administrator UID differs from reviewed configuration.' >&2
        exit 1
      fi
      /usr/sbin/dseditgroup -o checkmember -m ${lib.escapeShellArg cfg.adminUser} admin | /usr/bin/grep -q '^yes' || exit 1
    '';
  };
}
