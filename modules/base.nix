{ config, lib, pkgs, ... }:
let cfg = config.homelab;
in {
  options.homelab = {
    adminUser = lib.mkOption { type = lib.types.str; };
    adminUID = lib.mkOption { type = lib.types.int; default = 501; };
    activationReady = lib.mkOption {
      type = lib.types.bool; default = false;
      description = "Explicitly enabled only after provisioning and migration review.";
    };
  };
  config = {
    nixpkgs.hostPlatform = "aarch64-darwin";
    system.stateVersion = 6;
    system.primaryUser = cfg.adminUser;
    determinateNix.enable = true;
    nix.enable = false;
    time.timeZone = "America/Los_Angeles";
    environment.systemPackages = (with pkgs; [ git jq curl age sops ]) ++ [
      (import ../packages/client.nix { inherit pkgs; })
    ];
    nix-homebrew = { enable = true; user = cfg.adminUser; autoMigrate = false; };
    homebrew = {
      enable = true;
      onActivation = { cleanup = "zap"; autoUpdate = false; upgrade = false; };
      brews = [ ];
      casks = [ ];
    };
    system.activationScripts.preActivation.text = lib.mkBefore ''
      homelab_activation_ready="${lib.boolToString cfg.activationReady}"
      if [ "$homelab_activation_ready" != true ]; then
        echo 'Activation blocked: finish provisioning and review host migration first.' >&2
        exit 1
      fi
      if [ "$(/usr/bin/id -u ${lib.escapeShellArg cfg.adminUser})" != '${toString cfg.adminUID}' ]; then
        echo 'Existing administrator UID differs from reviewed configuration.' >&2
        exit 1
      fi
      /usr/sbin/dseditgroup -o checkmember -m ${lib.escapeShellArg cfg.adminUser} admin | /usr/bin/grep -q '^yes' || exit 1
    '';
  };
}
