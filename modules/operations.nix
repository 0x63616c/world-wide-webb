{ config, lib, pkgs, ... }:
let
  enabled = config.homelab.containers.enable || config.homelab.homeassistant.enable;
  wrapper = pkgs.writeShellScriptBin "homelab-operation" ''
    exec ${pkgs.python3}/bin/python3 ${../scripts}/operation-lock.py "$@"
  '';
  reconcile = pkgs.writeShellScriptBin "homelab-reconcile-all" ''
    set -eu
    ${lib.optionalString config.homelab.homeassistant.enable ''
      /run/current-system/sw/bin/homelab-reconcile-ha
    ''}
    ${lib.optionalString config.homelab.containers.enable ''
      /run/current-system/sw/bin/homelab-reconcile-containers
    ''}
    exec /run/current-system/sw/bin/homelab-health
  '';
in {
  config = lib.mkMerge [ {
    environment.etc."homelab/deployment.json".text = builtins.toJSON {
      host = config.networking.hostName;
      services = import ../lib/assigned-services.nix config.homelab;
      backupsEnabled = config.homelab.backups.enable;
    };
  } (lib.mkIf enabled {
    environment.systemPackages = [ wrapper reconcile ];
    system.activationScripts.postActivation.text = lib.mkAfter ''
      ${wrapper}/bin/homelab-operation --initialize
    '';
  }) ];
}
