{
  config,
  lib,
  pkgs,
  ...
}:
let
  enabled = config.homelab.containers.enable || config.homelab.homeassistant.enable;
  wrapper = pkgs.writeShellScriptBin "homelab-operation" ''
    exec ${pkgs.python3}/bin/python3 ${../scripts}/operation-lock.py "$@"
  '';
  services = import ../lib/assigned-services.nix config.homelab;
  hostTools = import ../packages/host.nix { inherit pkgs; };
  health =
    name:
    let
      settings = pkgs.writeText "homelab-health-${name}.json" (
        builtins.toJSON {
          services = [ name ];
          workersEnabled = config.homelab.containers.controlCenter.workersEnabled;
          dockerPath = "${pkgs.docker}/bin/docker";
          releasePath = "/etc/homelab/services/control-center/release.json";
          homeAssistantUrl = config.homelab.containers.controlCenter.homeAssistantURL;
        }
      );
    in
    [
      "${hostTools}/bin/homelab-services"
      "health"
      "--config"
      "${settings}"
    ];
  settings = pkgs.writeText "homelab-reconcile.json" (
    builtins.toJSON {
      inherit services;
      commands = builtins.listToAttrs (
        map (name: {
          inherit name;
          value =
            if name == "home-assistant" then
              [ "/run/current-system/sw/bin/homelab-reconcile-ha" ]
            else
              [
                "/run/current-system/sw/bin/homelab-reconcile-containers"
                name
              ];
        }) services
      );
      pullCommands = builtins.listToAttrs (
        map (name: {
          inherit name;
          value =
            if name == "home-assistant" then
              [
                "${pkgs.docker-compose}/bin/docker-compose"
                "-f"
                "${../services/home-assistant/compose.yaml}"
                "pull"
              ]
            else
              [
                "${pkgs.python3}/bin/python3"
                "${../scripts}/reconcile-service.py"
                name
                "--pull"
                "--compose-root"
                "${../services}"
              ];
        }) services
      );
      healthCommands = builtins.listToAttrs (
        map (name: {
          inherit name;
          value = health name;
        }) services
      );
    }
  );
  reconcile = pkgs.writeShellScriptBin "homelab-reconcile-all" ''
    export PATH=${
      lib.makeBinPath [
        pkgs.python3
        pkgs.docker
        pkgs.docker-compose
        pkgs.colima
        pkgs.openssh
        pkgs.coreutils
      ]
    }:/usr/bin:/bin
    export HOME=/var/lib/_containers
    export DOCKER_CONFIG=/run/secrets/registry
    export DOCKER_HOST=unix:///var/lib/_containers/.colima-ha/ha/docker.sock
    export WORKER_CYCLES=${
      if config.homelab.containers.controlCenter.workersEnabled then "on" else "off"
    }
    export HA_URL=${lib.escapeShellArg config.homelab.containers.controlCenter.homeAssistantURL}
    export BEDROOM_SWITCH_INPUT_ENABLED=${
      lib.boolToString (config.homelab.containers.controlCenter.bedroomSwitchInput != null)
    }
    export BEDROOM_SWITCH_INPUT_VERIFIED=${
      lib.boolToString (config.homelab.containers.controlCenter.bedroomSwitchInput != null)
    }
    export BEDROOM_SWITCH_INPUT_ENTITY_ID=${
      lib.escapeShellArg (
        if config.homelab.containers.controlCenter.bedroomSwitchInput == null then
          ""
        else
          config.homelab.containers.controlCenter.bedroomSwitchInput
      )
    }
    exec ${wrapper}/bin/homelab-operation -- \
      ${pkgs.python3}/bin/python3 ${../scripts}/reconcile-selected.py --config ${settings} "$@"
  '';

in
{
  config = lib.mkMerge [
    {
      environment.etc."projects/homelab/deployment.json".text = builtins.toJSON {
        host = config.networking.hostName;
        services = import ../lib/assigned-services.nix config.homelab;
        backupsEnabled = config.homelab.backups.enable;
        inputs = import ../lib/deployment-inputs.nix { inherit config lib pkgs; };
      };
    }
    (lib.mkIf enabled {
      environment.systemPackages = [
        wrapper
        reconcile
      ];
      system.activationScripts.postActivation.text = lib.mkAfter ''
        ${wrapper}/bin/homelab-operation --initialize
      '';
    })
  ];
}
