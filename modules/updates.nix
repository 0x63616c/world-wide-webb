{ config, lib, pkgs, ... }: {
  options.homelab.updates.enable = lib.mkEnableOption "verified-main automatic updates";
  config = lib.mkIf config.homelab.updates.enable {
    environment.systemPackages = [ pkgs.python3 ];
    environment.etc."homelab/updater".source = ../scripts;
    # Keep the plist stable when Nix store paths change. The updater rejects
    # candidate plist changes; those need a separate supervised manual switch.
    launchd.daemons.homelab-update.serviceConfig = {
      Label = "org.homelab.update";
      UserName = "root";
      ProgramArguments = [
        "/run/current-system/sw/bin/python3"
        "/etc/homelab/updater/update.py"
        "--host" config.networking.hostName
      ];
      EnvironmentVariables = {
        HOME = "/var/root";
        PATH = "/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin";
      };
      RunAtLoad = true;
      StartInterval = 600;
      ThrottleInterval = 60;
      ProcessType = "Background";
      LowPriorityIO = true;
    };
  };
}
