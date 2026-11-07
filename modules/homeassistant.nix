{ config, lib, pkgs, ... }:
let
  cfg = config.homelab.homeassistant;
  home = "/var/lib/_containers/.colima-ha";
  socket = "/var/run/homelab/ha-vmnet.sock";
  profile = pkgs.writeText "ha-colima.yaml" (builtins.toJSON {
    cpu = 2; memory = 2; disk = 12; rootDisk = 8;
    arch = "aarch64"; runtime = "docker"; vmType = "vz";
    autoActivate = false; portForwarder = "none";
    rosetta = false; forwardAgent = false; sshConfig = false;
    network = {
      address = true; mode = "bridged";
      interface = cfg.bridgeInterface; preferredRoute = false;
    };
  });
  override = pkgs.writeText "ha-lima-override.yaml" (builtins.toJSON {
    networks = [{ inherit socket; interface = "ha0"; }];
  });
  reconcile = pkgs.writeShellScriptBin "homelab-reconcile-ha" ''
          set -eu
          export PATH=${lib.makeBinPath [ pkgs.docker pkgs.docker-compose pkgs.coreutils ]}
          export HOME=/var/lib/_containers
          export DOCKER_HOST=unix://${home}/ha/docker.sock
          [ "$(id -u)" = ${toString config.users.users._containers.uid} ] || { echo 'Run as _containers.' >&2; exit 1; }
          for attempt in $(seq 1 120); do
            if docker info >/dev/null 2>&1; then break; fi
            sleep 5
          done
          docker info >/dev/null
          # External volume means missing restoration fails instead of creating
          # an empty HA installation. Never create/import it in this daemon.
          docker volume inspect ha_config >/dev/null
          exec /run/current-system/sw/bin/homelab-operation -- \
            docker-compose -f /etc/homelab/home-assistant/compose.yaml \
            up -d --wait --wait-timeout 240
  '';
in {
  options.homelab.homeassistant = {
    enable = lib.mkEnableOption "existing bridged Home Assistant container VM";
    bridgeInterface = lib.mkOption {
      type = lib.types.nullOr (lib.types.strMatching "en[0-9]+");
      default = null;
      description = "Verified physical LAN interface on the target host; never assume en1 transfers between Macs.";
    };
    haos.enable = lib.mkEnableOption "future HA OS VM (not the existing HA container)";
  };
  config = lib.mkMerge [
    {
      assertions = [
        {
          assertion = !cfg.haos.enable;
          message = "HA OS is a future migration. Preserve the existing bridged HA container.";
        }
        {
          assertion = !cfg.enable || cfg.bridgeInterface != null;
          message = "HA requires a verified target bridgeInterface before enablement.";
        }
      ];
    }
    (lib.mkIf cfg.enable {
      homebrew.brews = [ "socket_vmnet" ];
      environment.systemPackages = with pkgs; [ colima docker docker-compose reconcile ];
      environment.etc."homelab/home-assistant/compose.yaml".source = ../services/home-assistant/compose.yaml;
      # Only the small vmnet helper runs as root. Socket access is limited to
      # _containers; no passwordless sudo is granted to the service account.
      launchd.daemons.homelab-ha-vmnet = {
        script = ''
          set -eu
          /usr/bin/install -d -o root -g _containers -m 0750 /var/run/homelab
          exec /opt/homebrew/opt/socket_vmnet/bin/socket_vmnet \
            --socket-group=_containers --vmnet-mode=bridged \
            --vmnet-interface=${lib.escapeShellArg (if cfg.bridgeInterface == null then "" else cfg.bridgeInterface)} \
            ${socket}
        '';
        serviceConfig = { RunAtLoad = true; KeepAlive = true; ThrottleInterval = 30; };
      };
      launchd.daemons.homelab-ha-colima = {
        path = with pkgs; [ colima docker openssh coreutils python3 ];
        environment = { HOME = "/var/lib/_containers"; COLIMA_HOME = home; };
        script = ''
          set -eu
          mkdir -p ${home}/ha ${home}/_lima/_config
          cp ${profile} ${home}/ha/colima.yaml
          cp ${override} ${home}/_lima/_config/override.yaml
          # Verify connection permission, not merely socket-path existence.
          python3 - <<'PY'
          import socket
          import time
          deadline = time.monotonic() + 120
          while True:
              try:
                  with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
                      probe.settimeout(2)
                      probe.connect('${socket}')
                  break
              except OSError:
                  if time.monotonic() >= deadline:
                      raise
                  time.sleep(2)
          PY
          exec colima start ha --activate=false --port-forwarder none --foreground
        '';
        serviceConfig = {
          UserName = "_containers"; GroupName = "_containers";
          RunAtLoad = true; KeepAlive = true; ThrottleInterval = 30;
        };
      };
      launchd.daemons.homelab-ha-compose = {
        path = with pkgs; [ docker docker-compose coreutils ];
        environment = {
          HOME = "/var/lib/_containers";
          DOCKER_HOST = "unix://${home}/ha/docker.sock";
        };
        script = ''
          exec ${reconcile}/bin/homelab-reconcile-ha
        '';
        serviceConfig = {
          UserName = "_containers"; GroupName = "_containers";
          RunAtLoad = true; StartInterval = 600; ThrottleInterval = 60;
        };
      };
    })
  ];
}
