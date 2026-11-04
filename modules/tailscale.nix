{ config, pkgs, ... }:
let
  hostTools = import ../packages/client.nix { inherit pkgs; };
in {
  services.tailscale.enable = true;
  # Remote access must recover if the daemon exits after its boot-time start.
  launchd.daemons.tailscaled.serviceConfig.KeepAlive = true;

  launchd.daemons.homelab-tailscale-enroll.serviceConfig = {
    ProgramArguments = [
      "${hostTools}/bin/homelab-host"
      "tailscale"
      "--executable"
      "${config.services.tailscale.package}/bin/tailscale"
      "--hostname"
      config.networking.hostName
    ];
    UserName = "root";
    RunAtLoad = true;
    StartInterval = 300;
    ProcessType = "Background";
  };
}
