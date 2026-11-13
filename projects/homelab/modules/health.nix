{ config, pkgs, ... }:
let
  services = import ../lib/assigned-services.nix config.homelab;
  hostTools = import ../packages/host.nix { inherit pkgs; };
  settings = pkgs.writeText "homelab-health.json" (
    builtins.toJSON {
      inherit services;
      workersEnabled = config.homelab.containers.controlCenter.workersEnabled;
      dockerPath = "${pkgs.docker}/bin/docker";
      releasePath = "/etc/homelab/services/control-center/release.json";
      homeAssistantUrl = config.homelab.containers.controlCenter.homeAssistantURL;
    }
  );
  command = pkgs.writeShellScriptBin "homelab-health" ''
    exec ${hostTools}/bin/homelab-services health --config ${settings}
  '';
in
{
  environment.systemPackages = [ command ];
}
