# MacBook-only service: imported by its host, never by the Mini.
{ lib, pkgs, ... }:
let
  package = import ../packages/rex.nix { inherit pkgs; };
  agentHome = "/Users/coding";
  logDirectory = "/var/log/homelab-rex";
  logFile = "${logDirectory}/server.log";
  logrotateConfig = pkgs.writeText "homelab-rex-logrotate.conf" ''
    ${logFile} {
      size 5M
      rotate 2
      copytruncate
      missingok
      notifempty
    }
  '';
in
{
  environment.systemPackages = [ package ];
  # launchd is the sole server owner, including when an SSH connection arrives
  # during startup/replacement. CLI/SSH must not create a competing server.
  environment.variables.REX_AUTOSTART = "0";
  # nix-darwin resets PATH in interactive shells; retain the server's matching CLI.
  environment.interactiveShellInit = ''
    if [ -n "$REX_BIN_DIR" ]; then
      export PATH="$REX_BIN_DIR:$PATH"
    fi
  '';
  system.activationScripts.users.text = lib.mkAfter ''
    /usr/bin/install -d -o vov -g staff -m 0700 ${logDirectory}
  '';
  launchd.daemons.homelab-rex = {
    serviceConfig = {
      # Do not use command/script: nix-darwin wraps them in /bin/sh, and TCC
      # retains that shell's identity across exec. Launch the signed helper
      # directly so Full Disk Access applies to Rex and its terminal children.
      # KeepAlive retries startup if the Nix volume has not mounted yet.
      ProgramArguments = [
        "${package}/libexec/Rex Server.rex/Contents/MacOS/rex"
        "server"
        "run"
        "--state-dir"
        "${agentHome}/.local/state/rex"
      ];
      UserName = "vov";
      GroupName = "staff";
      WorkingDirectory = agentHome;
      EnvironmentVariables = {
        HOME = agentHome;
        USER = "vov";
        LOGNAME = "vov";
        SHELL = "${pkgs.zsh}/bin/zsh";
        PATH = "${package}/bin:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin";
      };
      RunAtLoad = true;
      KeepAlive = true;
      ThrottleInterval = 30;
      Umask = 63;
      StandardOutPath = logFile;
      StandardErrorPath = logFile;
    };
  };
  # Rotation runs as vov, never restarts Rex, and keeps its open log FD valid.
  # A shell is harmless here: this job never launches Rex or its terminals.
  launchd.daemons.homelab-rex-logrotate = {
    command = lib.escapeShellArgs [
      "${pkgs.logrotate}/bin/logrotate"
      "--state"
      "${logDirectory}/logrotate.status"
      "${logrotateConfig}"
    ];
    serviceConfig = {
      UserName = "vov";
      GroupName = "staff";
      RunAtLoad = true;
      StartInterval = 3600;
      StandardOutPath = "/dev/null";
      StandardErrorPath = "/dev/null";
    };
  };
}
