{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.homelab.homeassistant;
  home = "/var/lib/_containers/.colima-ha";
  socket = "/var/run/homelab/ha-vmnet.sock";
  profile = pkgs.writeText "ha-colima.yaml" (
    builtins.toJSON {
      cpu = cfg.cpu;
      memory = cfg.memoryGiB;
      disk = 12;
      rootDisk = 8;
      arch = "aarch64";
      runtime = "docker";
      vmType = "vz";
      autoActivate = false;
      portForwarder = "none";
      rosetta = false;
      forwardAgent = false;
      sshConfig = false;
      network = {
        address = true;
        mode = "bridged";
        interface = cfg.bridgeInterface;
        preferredRoute = false;
      };
    }
  );
  ipv4Octet = "(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";
  ipv4 = "${ipv4Octet}[.]${ipv4Octet}[.]${ipv4Octet}[.]${ipv4Octet}";
  staticLAN = cfg.lanIPv4 != null && cfg.lanIPv4Gateway != null;
  lanNetwork = builtins.toJSON {
    network = {
      version = 2;
      ethernets.ha0 = {
        dhcp4 = false;
        addresses = [ cfg.lanIPv4 ];
        routes = [
          {
            to = "0.0.0.0/0";
            via = cfg.lanIPv4Gateway;
            metric = 50;
          }
        ];
      };
    };
  };
  override = pkgs.writeText "ha-lima-override.yaml" (
    builtins.toJSON (
      {
        networks = [
          {
            inherit socket;
            interface = "ha0";
          }
        ];
      }
      // lib.optionalAttrs staticLAN {
        provision = [
          {
            mode = "system";
            script = ''
              #!/bin/sh
              set -eu
              # Lima's generated netplan uses the interface name as its key. A later
              # file overrides ha0 only, preserving its MAC match and the management NIC.
              command -v netplan >/dev/null
              install -d -m 0755 /etc/netplan
              umask 077
              cat > /etc/netplan/99-homelab-ha.yaml <<'HOMELAB_HA_NETWORK'
              ${lanNetwork}
              HOMELAB_HA_NETWORK
              chmod 0600 /etc/netplan/99-homelab-ha.yaml
              netplan generate
              netplan apply
            '';
          }
        ];
      }
    )
  );
  reconcile = pkgs.writeShellScriptBin "homelab-reconcile-ha" ''
    set -eu
    export PATH=${
      lib.makeBinPath [
        pkgs.docker
        pkgs.docker-compose
        (pkgs.python3.withPackages (ps: [ ps.pyyaml ]))
        pkgs.coreutils
      ]
    }
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
      python3 ${../scripts/provision-ha.py} ${../services/home-assistant} \
      ${../../control-center/server/config/vacuum.json}
  '';
  stop = pkgs.writeShellScriptBin "homelab-stop-ha" ''
    set -eu
    export HOME=/var/lib/_containers
    export COLIMA_HOME=${home}
    export PATH=${
      lib.makeBinPath [
        pkgs.colima
        pkgs.openssh
        pkgs.coreutils
      ]
    }:/usr/bin:/bin:/usr/sbin:/sbin
    [ "$(id -u)" = ${toString config.users.users._containers.uid} ] || { echo 'Run as _containers.' >&2; exit 1; }
    exec colima stop ha
  '';
in
{
  options.homelab.homeassistant = {
    enable = lib.mkEnableOption "existing bridged Home Assistant container VM";
    cpu = lib.mkOption {
      type = lib.types.ints.positive;
      default = 2;
    };
    memoryGiB = lib.mkOption {
      type = lib.types.ints.positive;
      default = 3;
    };
    bridgeInterface = lib.mkOption {
      type = lib.types.nullOr (lib.types.strMatching "en[0-9]+");
      default = null;
      description = "Verified physical LAN interface on the target host; never assume en1 transfers between Macs.";
    };
    lanIPv4 = lib.mkOption {
      type = lib.types.nullOr (lib.types.strMatching "${ipv4}/([0-9]|[12][0-9]|3[0-2])");
      default = null;
      description = "Optional stable IPv4/CIDR for the HA guest's bridged ha0 interface.";
    };
    lanIPv4Gateway = lib.mkOption {
      type = lib.types.nullOr (lib.types.strMatching ipv4);
      default = null;
      description = "LAN IPv4 gateway paired with lanIPv4; its default route uses metric 50.";
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
        {
          assertion = (cfg.lanIPv4 == null) == (cfg.lanIPv4Gateway == null);
          message = "HA static LAN networking requires both lanIPv4 and lanIPv4Gateway.";
        }
      ];
    }
    (lib.mkIf cfg.enable {
      homebrew.brews = [ "socket_vmnet" ];
      environment.systemPackages = with pkgs; [
        colima
        docker
        docker-compose
        reconcile
        stop
      ];
      environment.etc."homelab/home-assistant/compose.yaml".source =
        ../services/home-assistant/compose.yaml;
      # Only the small vmnet helper runs as root. Socket access is limited to
      # _containers; no passwordless sudo is granted to the service account.
      launchd.daemons.homelab-ha-vmnet = {
        script = ''
          set -eu
          # The transaction stops the existing guest before replacing this backend.
          # At boot, wait for physical LAN readiness before attaching vmnet.
          ${pkgs.python3}/bin/python3 ${../scripts/wait-for-lan.py} ${
            lib.escapeShellArg (if cfg.bridgeInterface == null then "" else cfg.bridgeInterface)
          }
          /usr/bin/install -d -o root -g _containers -m 0750 /var/run/homelab
          exec /opt/homebrew/opt/socket_vmnet/bin/socket_vmnet \
            --socket-group=_containers --vmnet-mode=bridged \
            --vmnet-interface=${
              lib.escapeShellArg (if cfg.bridgeInterface == null then "" else cfg.bridgeInterface)
            } \
            ${socket}
        '';
        serviceConfig = {
          RunAtLoad = true;
          KeepAlive = true;
          ThrottleInterval = 30;
          StandardOutPath = "/var/log/homelab-ha-vmnet.log";
          StandardErrorPath = "/var/log/homelab-ha-vmnet.log";
        };
      };
      launchd.daemons.homelab-ha-colima = {
        path = with pkgs; [
          colima
          docker
          openssh
          coreutils
          python3
        ];
        environment = {
          HOME = "/var/lib/_containers";
          COLIMA_HOME = home;
        };
        script = ''
          set -eu
          # Lima/Colima need native macOS version and virtualization utilities.
          export PATH="$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
          # The deployment transaction stops the existing guest before replacing
          # either launcher, so it attaches to the new bridge on its next start.
          ${pkgs.python3}/bin/python3 ${../scripts/wait-for-lan.py} ${
            lib.escapeShellArg (if cfg.bridgeInterface == null then "" else cfg.bridgeInterface)
          }
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
          UserName = "_containers";
          GroupName = "_containers";
          RunAtLoad = true;
          KeepAlive = true;
          ThrottleInterval = 30;
        };
      };
      launchd.daemons.homelab-ha-compose = {
        path = with pkgs; [
          docker
          docker-compose
          coreutils
        ];
        environment = {
          HOME = "/var/lib/_containers";
          DOCKER_HOST = "unix://${home}/ha/docker.sock";
        };
        script = ''
          exec ${reconcile}/bin/homelab-reconcile-ha
        '';
        serviceConfig = {
          UserName = "_containers";
          GroupName = "_containers";
          RunAtLoad = true;
          StartInterval = 600;
          ThrottleInterval = 60;
        };
      };
    })
  ];
}
