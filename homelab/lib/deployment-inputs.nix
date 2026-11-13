{
  config,
  lib,
  pkgs,
}:
let
  names = import ./assigned-services.nix config.homelab;
  hash = value: builtins.hashString "sha256" (builtins.toJSON value);
  sourceHash = path: builtins.hashFile "sha256" path;
  cfg = config.homelab;
  secretFile = ../../secrets + "/${config.networking.hostName}.sops.yaml";
  # Ciphertext only. Rotation conservatively selects its application consumers.
  ciphertext = if builtins.pathExists secretFile then sourceHash secretFile else "missing";
  serviceFiles =
    name:
    let
      root = ../services + "/${name}";
      walk =
        dir:
        lib.concatMap (
          entry:
          let
            path = dir + "/${entry}";
            kind = (builtins.readDir dir).${entry};
          in
          if kind == "directory" then
            walk path
          else
            [
              {
                file = lib.removePrefix (toString root + "/") (toString path);
                sha256 = sourceHash path;
              }
            ]
        ) (builtins.attrNames (builtins.readDir dir));
    in
    walk root;
  scripts = builtins.filter (name: lib.hasSuffix ".py" name) (
    builtins.attrNames (builtins.readDir ../scripts)
  );
  safety = map (name: sourceHash (../scripts + "/${name}")) scripts;
  hostModules = [
    "base"
    "users"
    "ssh"
    "tailscale"
    "power"
    "secrets"
    "manifest"
    "updates"
  ];
in
{
  version = 1;
  shared = {
    host = hash {
      modules = map (name: sourceHash (../modules + "/${name}.nix")) hostModules;
      inherit (cfg) adminUser adminUID authorizedKeys;
      networking = config.networking.hostName;
      packages = map toString [
        pkgs.colima
        pkgs.docker
        pkgs.docker-compose
        pkgs.python3
      ];
    };
    safety = hash {
      inherit safety;
      operations = sourceHash ../modules/operations.nix;
      backups = sourceHash ../modules/backups.nix;
      planner = sourceHash ./deployment-inputs.nix;
      flake = sourceHash ../flake.nix;
      outputs = sourceHash ../flake-outputs.nix;
      lock = sourceHash ../flake.lock;
    };
    containers = hash {
      inherit (cfg.containers) enable memoryGiB diskGiB;
      daemon = config.launchd.daemons.homelab-colima or { };
    };
    home-assistant = hash {
      inherit (cfg.homeassistant)
        enable
        cpu
        memoryGiB
        bridgeInterface
        lanIPv4
        lanIPv4Gateway
        ;
      daemon = config.launchd.daemons.homelab-ha-colima or { };
      vmnet = config.launchd.daemons.homelab-ha-vmnet or { };
    };
  };
  services = builtins.listToAttrs (
    map (name: {
      inherit name;
      value = {
        configuration = hash {
          files = serviceFiles name;
          controlCenter = if name == "control-center" then cfg.containers.controlCenter else null;
          # Execution changes affect their consumers, not just file locations.
          module = sourceHash (
            if name == "home-assistant" then ../modules/homeassistant.nix else ../modules/containers.nix
          );
        };
        # Image-only edits are ordinary deployments. Conservatively require an
        # off-host point for other Compose edits, which can alter mounts/users.
        storage = hash (
          builtins.filter (line: builtins.match "[[:space:]]*image:.*" line == null) (
            lib.splitString "\n" (builtins.readFile (../services + "/${name}/compose.yaml"))
          )
        );
        secrets = hash (if name == "home-assistant" then null else ciphertext);
      };
    }) names
  );
}
