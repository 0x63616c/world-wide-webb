{
  config,
  lib,
  pkgs,
  ...
}:
let
  manifest = builtins.fromJSON (builtins.readFile ../homelab.json);
  hostTools = import ../packages/client.nix { inherit pkgs; };
in
{
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
      "--tag"
      manifest.tailscale.tag
    ];
    UserName = "root";
    RunAtLoad = true;
    StartInterval = 300;
    ProcessType = "Background";
  };

  # The app's installed URL is a stable service, independent of host enrollment.
  # Define/approve svc:homelab in the tailnet before first activation.
  launchd.daemons.homelab-control-center-access =
    lib.mkIf
      (
        config.homelab.containers.enable
        && builtins.elem "control-center" config.homelab.containers.services
        && config.networking.hostName == "homelab-mac-mini"
      )
      {
        serviceConfig = {
          ProgramArguments = [
            "${pkgs.python3}/bin/python3"
            "${../scripts/control-center-access.py}"
            "${config.services.tailscale.package}/bin/tailscale"
          ];
          UserName = "root";
          RunAtLoad = true;
          StartInterval = 60;
          ProcessType = "Background";
          StandardOutPath = "/dev/null";
          StandardErrorPath = "/dev/null";
        };
      };
}
