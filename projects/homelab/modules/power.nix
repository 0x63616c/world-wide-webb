{ pkgs, ... }:
let
  hostTools = import ../packages/client.nix { inherit pkgs; };
in
{
  launchd.daemons.homelab-power.serviceConfig = {
    ProgramArguments = [
      "${hostTools}/bin/homelab-host"
      "power"
    ];
    UserName = "root";
    RunAtLoad = true;
    # A laptop may boot on battery, when macOS cannot report AC capabilities.
    StartInterval = 300;
  };
}
