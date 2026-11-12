{ config, lib, ... }:
let
  host = config.networking.hostName;
  path = ../../secrets + "/${host}.sops.yaml";
  exists = builtins.pathExists path;
  services = config.homelab.containers.services;
  selected = name: config.homelab.containers.enable && builtins.elem name services;
  containerSecret = key: {
    inherit key;
    owner = "_containers";
    group = "_containers";
    mode = "0400";
  };
  # Names verified on the live mini; no credential values were read/imported.
  wwwNames = [
    "HA_TOKEN" "ALARM_API_TOKEN"
    "HOME_LAT" "HOME_LON" "WIFI_GUEST_SSID" "WIFI_GUEST_PASSWORD"
  ];
in {
  options.homelab.secretsAvailable = lib.mkOption {
    type = lib.types.bool; readOnly = true; default = exists;
  };
  config = lib.mkMerge [
    {
      sops.age.keyFile = "/var/lib/sops-nix/key.txt";
      sops.age.generateKey = false;
      sops.age.sshKeyPaths = [ ];
      sops.gnupg.sshKeyPaths = [ ];
      system.activationScripts.preActivation.text = lib.mkAfter ''
        homelab_secrets_available="${lib.boolToString exists}"
        if [ "$homelab_secrets_available" != true ]; then
          echo 'Provision real host SOPS secrets before activation.' >&2
          exit 1
        fi
        test -s /var/lib/sops-nix/key.txt || { echo 'Host age key missing.' >&2; exit 1; }
      '';
    }
    (lib.mkIf exists {
      sops.defaultSopsFile = path;
      sops.secrets = lib.mkMerge [
        {
          tailscale-auth-key = { mode = "0400"; };
        }
        (lib.mkIf config.homelab.containers.enable {
          containers-env = { owner = "_containers"; group = "_containers"; mode = "0400"; };
        })
        (lib.mkIf (selected "control-center") (builtins.listToAttrs (map (name: {
          name = "www-${name}";
          value = containerSecret "services/control-center/${name}";
        }) wwwNames)))
        (lib.mkIf (selected "control-center") {
          "registry/config.json" = containerSecret "services/registry/docker-config";
        })
        (lib.mkIf (selected "hindsight") {
          hindsight-env = containerSecret "services/hindsight/environment";
        })
        (lib.mkIf (selected "cloudflared") {
          tunnel-token = containerSecret "services/cloudflared/token";
        })
        (lib.mkIf (selected "penpot") {
          penpot-env = containerSecret "services/penpot/environment";
        })
        (lib.mkIf (selected "golink") {
          golink-env = containerSecret "services/golink/environment";
        })
        (lib.mkIf (selected "beszel") {
          beszel-env = containerSecret "services/beszel/environment";
        })
        (lib.mkIf (selected "bambuddy") {
          bambuddy-environment = containerSecret "services/bambuddy/environment";
        })
        (lib.mkIf config.homelab.backups.enable {
          nas-backup-credentials = containerSecret "backups/nas-credentials";
        })
      ];
    })
  ];
}
