# MacBook-only service: imported by its host, never by the Mini.
{ lib, pkgs, ... }:
let
  package = import ../packages/rex.nix { inherit pkgs; };
  codingHome = "/Users/coding";
  loggedServer = pkgs.writeShellScript "homelab-rex" ''
    # Keep Rex as launchd's main PID so it receives shutdown signals directly.
    exec ${package}/bin/rex server run --state-dir ${lib.escapeShellArg "${codingHome}/.local/state/rex"} > >(/usr/bin/logger -t homelab-rex) 2>&1
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
  launchd.daemons.homelab-rex = {
    # nix-darwin waits for /nix/store. The default 0600 user socket is also what
    # Rex's SSH transport discovers; do not add a second server or network listener.
    command = lib.escapeShellArgs [ "${loggedServer}" ];
    serviceConfig = {
      UserName = "coding";
      GroupName = "staff";
      WorkingDirectory = codingHome;
      EnvironmentVariables = {
        HOME = codingHome;
        USER = "coding";
        LOGNAME = "coding";
        SHELL = "/bin/zsh";
        PATH = "${package}/bin:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin";
      };
      RunAtLoad = true;
      KeepAlive = true;
      ThrottleInterval = 30;
      Umask = 63;
      # Unified logging owns retention; no unbounded terminal log in the home.
      StandardOutPath = "/dev/null";
      StandardErrorPath = "/dev/null";
    };
  };
}
