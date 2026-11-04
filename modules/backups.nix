{ config, lib, pkgs, ... }:
let
  cfg = config.homelab.backups;
  services = import ../lib/assigned-services.nix config.homelab;
  settings = pkgs.writeText "homelab-backup.json" (builtins.toJSON {
    host = config.networking.hostName;
    inherit services;
    root = "/var/lib/_containers/backups";
    inherit (cfg) keepLocal minFreeGiB;
  });
  command = pkgs.writeShellScriptBin "homelab-backup-now" ''
    set -eu
    export PATH=${lib.makeBinPath [ pkgs.python3 pkgs.docker pkgs.coreutils pkgs.gnutar pkgs.gzip ]}
    export HOME=/var/lib/_containers
    [ "$(id -u)" = 350 ] || { echo 'Run as _containers.' >&2; exit 1; }
    exec /run/current-system/sw/bin/homelab-operation -- \
      python3 ${../scripts}/backup.py --config ${settings}
  '';

in {
  options.homelab.backups = {
    enable = lib.mkEnableOption "verified nightly service snapshots";
    keepLocal = lib.mkOption { type = lib.types.ints.positive; default = 7; };
    minFreeGiB = lib.mkOption { type = lib.types.ints.positive; default = 30; };
  };
  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ command ];
    assertions = [
      { assertion = services != [ ]; message = "Backups require assigned services."; }
    ];
    launchd.daemons.homelab-backup = {
      path = with pkgs; [ python3 docker coreutils gnutar gzip ];
      environment.HOME = "/var/lib/_containers";
      script = ''
        exec ${command}/bin/homelab-backup-now
      '';
      serviceConfig = {
        UserName = "_containers"; GroupName = "_containers";
        StartCalendarInterval = [{ Hour = 4; Minute = 15; }];
        ProcessType = "Background";
        LowPriorityIO = true;
      };
    };
  };
}
