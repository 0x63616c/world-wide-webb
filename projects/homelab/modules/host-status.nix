# Exports the Mini's NAS/deploy summary and redacted log tails into a folder that
# Control Center mounts read-only. The container never gets the Docker socket.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  services = import ../lib/assigned-services.nix config.homelab;
  output = "/var/lib/_containers/host-status";
  id = toString config.users.users._containers.uid;
in
{
  config = lib.mkIf (builtins.elem "control-center" services) {
    # Compose refuses to create bind sources, so the folder exists before reconcile.
    system.activationScripts.postActivation.text = lib.mkAfter ''
      /usr/bin/install -d -o ${id} -g ${id} -m 0700 ${output}
    '';
    launchd.daemons.homelab-host-status = {
      command = lib.escapeShellArgs [
        "${pkgs.python3}/bin/python3"
        "${../scripts}/host-status.py"
        "--output"
        output
        "--backups"
        "/var/lib/_containers/backups"
        "--operations"
        "/var/lib/homelab-operations"
        "--docker"
        "${pkgs.docker}/bin/docker"
        "--socket"
        "/var/lib/_containers/.colima/services/docker.sock"
        "--socket"
        "/var/lib/_containers/.colima-ha/ha/docker.sock"
        "--file"
        "deploy=/var/lib/homelab-operations/activation.log"
        "--file"
        "backup=/var/lib/_containers/backup.log"
        "--file"
        "colima=/var/lib/_containers/colima-startup.log"
        "--owner"
        "${id}:${id}"
      ];
      serviceConfig = {
        RunAtLoad = true;
        StartInterval = 60;
        ThrottleInterval = 30;
        ProcessType = "Background";
        LowPriorityIO = true;
        Nice = 10;
      };
    };
  };
}
