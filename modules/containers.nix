{ config, lib, pkgs, ... }:
let
  cfg = config.homelab.containers;
  reconcile = pkgs.writeShellScriptBin "homelab-reconcile-containers" ''
        set -eu
        export PATH=${lib.makeBinPath [ pkgs.docker pkgs.docker-compose pkgs.coreutils pkgs.python3 ]}
        export HOME=/var/lib/_containers
        export DOCKER_HOST=unix:///var/lib/_containers/.colima/services/docker.sock
        export WORKER_CYCLES=${if cfg.controlCenter.workersEnabled then "on" else "off"}
        export HA_URL=${lib.escapeShellArg cfg.controlCenter.homeAssistantURL}
        [ "$(id -u)" = ${toString config.users.users._containers.uid} ] || { echo 'Run as _containers.' >&2; exit 1; }
        for attempt in $(seq 1 120); do
          if docker info >/dev/null 2>&1 && [ -s /run/secrets/containers-env ]; then break; fi
          sleep 5
        done
        docker info >/dev/null
        test -s /run/secrets/containers-env
        ${lib.concatMapStringsSep "\n" (name: ''
          /run/current-system/sw/bin/homelab-operation -- \
            python3 ${../scripts}/reconcile-service.py ${name}
        '') cfg.services}
        exec /run/current-system/sw/bin/homelab-operation -- \
          /run/current-system/sw/bin/homelab-health
  '';

in {
  options.homelab.containers = {
    enable = lib.mkEnableOption "service-owned Colima runtime";
    services = lib.mkOption {
      type = lib.types.listOf (lib.types.enum [ "bambuddy" "control-center" "hindsight" "cloudflared" "penpot" ]);
      default = [ ];
    };
    memoryGiB = lib.mkOption { type = lib.types.ints.positive; default = 6; };
    diskGiB = lib.mkOption { type = lib.types.ints.positive; default = 60; };
    controlCenter.workersEnabled = lib.mkOption {
      type = lib.types.bool; default = false;
      description = "Enable production workers only after transfer of ownership; restore rehearsals stay off.";
    };
    controlCenter.homeAssistantURL = lib.mkOption {
      type = lib.types.str; default = "http://192.168.0.130:8123";
    };
  };
  config = lib.mkIf cfg.enable {
    environment.systemPackages = with pkgs; [ colima docker docker-compose reconcile ];
    environment.etc."homelab/services".source = ../services;
    launchd.daemons.homelab-colima = {
      path = with pkgs; [ colima docker docker-compose openssh coreutils ];
      environment = { HOME = "/var/lib/_containers"; };
      script = ''
        set -eu
        # Colima probes macOS with native tools before exposing VZ/Rosetta flags.
        export PATH="$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
        exec colima start --profile services --foreground --vm-type vz \
          --vz-rosetta --cpu 4 --memory ${toString cfg.memoryGiB} \
          --mount /var/lib/_containers:w \
          --disk ${toString cfg.diskGiB}
      '';
      serviceConfig = {
        UserName = "_containers"; GroupName = "_containers";
        RunAtLoad = true; KeepAlive = true; ThrottleInterval = 30;
      };
    };
    launchd.daemons.homelab-compose = {
      path = with pkgs; [ docker docker-compose coreutils python3 ];
      environment = {
        HOME = "/var/lib/_containers";
        DOCKER_HOST = "unix:///var/lib/_containers/.colima/services/docker.sock";
        WORKER_CYCLES = if cfg.controlCenter.workersEnabled then "on" else "off";
        HA_URL = cfg.controlCenter.homeAssistantURL;
      };
      script = ''
        exec ${reconcile}/bin/homelab-reconcile-containers
      '';
      serviceConfig = {
        UserName = "_containers"; GroupName = "_containers";
        RunAtLoad = true; StartInterval = 600; ThrottleInterval = 60;
      };
    };
  };
}
