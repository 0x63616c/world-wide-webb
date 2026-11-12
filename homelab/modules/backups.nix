{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.homelab.backups;
  services = import ../lib/assigned-services.nix config.homelab;
  hostTools = import ../packages/host.nix { inherit pkgs; };
  scopedHealth =
    name: assigned:
    let
      settings = pkgs.writeText "homelab-backup-health-${name}.json" (
        builtins.toJSON {
          services = assigned;
          workersEnabled = config.homelab.containers.controlCenter.workersEnabled;
          dockerPath = "${pkgs.docker}/bin/docker";
          releasePath = "/etc/homelab/services/control-center/release.json";
        }
      );
    in
    [
      "${hostTools}/bin/homelab-services"
      "health"
      "--config"
      "${settings}"
    ];
  settings = pkgs.writeText "homelab-backup.json" (
    builtins.toJSON {
      host = config.networking.hostName;
      inherit services;
      root = "/var/lib/_containers/backups";
      inherit (cfg) keepLocal minFreeGiB;
      reconcileCommand = "/run/current-system/sw/bin/homelab-reconcile-all";
      healthCommands = {
        control-center-hourly = scopedHealth "control-center-hourly" [ "control-center" ];
        penpot = scopedHealth "penpot" [ "penpot" ];
      };
    }
  );
  command = pkgs.writeShellScriptBin "homelab-backup-now" ''
    set -eu
    export PATH=${
      lib.makeBinPath [
        pkgs.python3
        pkgs.docker
        pkgs.coreutils
        pkgs.gnutar
        pkgs.gzip
      ]
    }
    export HOME=/var/lib/_containers
    export PYTHONTZPATH=${pkgs.tzdata}/share/zoneinfo
    [ "$(id -u)" = ${toString config.users.users._containers.uid} ] || { echo 'Run as _containers.' >&2; exit 1; }
    if [ "''${1:-}" = --publish-pending ] || [ "''${1:-}" = --publish-transaction ]; then
      exec python3 ${../scripts}/backup.py --config ${settings} "$@"
    fi
    exec /run/current-system/sw/bin/homelab-operation -- \
      python3 ${../scripts}/backup.py --config ${settings} "$@"
  '';
  job = scope: calendar: {
    path = with pkgs; [
      python3
      docker
      coreutils
      gnutar
      gzip
    ];
    environment.HOME = "/var/lib/_containers";
    script = ''
      exec ${command}/bin/homelab-backup-now --scope ${scope} --local-only
    '';
    serviceConfig = {
      UserName = "_containers";
      GroupName = "_containers";
      StartCalendarInterval = [ calendar ];
      ProcessType = "Background";
      LowPriorityIO = true;
    };
  };
in
{
  options.homelab.backups = {
    enable = lib.mkEnableOption "verified service snapshots and recovery history";
    keepLocal = lib.mkOption {
      type = lib.types.ints.positive;
      default = 7;
    };
    minFreeGiB = lib.mkOption {
      type = lib.types.ints.positive;
      default = 30;
    };
  };
  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ command ];
    assertions = [
      {
        assertion = services != [ ];
        message = "Backups require assigned services.";
      }
    ];
    launchd.daemons = {
      homelab-backup = job "full" {
        Hour = 4;
        Minute = 15;
      };
      homelab-backup-publisher = {
        path = with pkgs; [
          python3
          docker
          coreutils
          gnutar
          gzip
        ];
        environment.HOME = "/var/lib/_containers";
        script = ''
          # One launchd owner bounds network work across all backup scopes.
          exec ${pkgs.coreutils}/bin/timeout --kill-after=10s 15m \
            ${command}/bin/homelab-backup-now --publish-pending
        '';
        serviceConfig = {
          UserName = "_containers";
          GroupName = "_containers";
          RunAtLoad = true;
          StartInterval = 60;
          ThrottleInterval = 30;
          ProcessType = "Background";
          LowPriorityIO = true;
          Nice = 10;
        };
      };
    }
    // lib.optionalAttrs (builtins.elem "control-center" services) {
      homelab-control-center-hourly-backup = job "control-center-hourly" { Minute = 0; };
    }
    // lib.optionalAttrs (builtins.elem "penpot" services) {
      homelab-penpot-backup = job "penpot" {
        Hour = 5;
        Minute = 15;
      };
    };
  };
}
