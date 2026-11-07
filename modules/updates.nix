{ config, inputs, lib, pkgs, ... }:
let
  hostTools = import ../packages/client.nix { inherit pkgs; };
  cominConfiguration = import (inputs.comin + "/nix/comin-config.nix") {
    inherit config lib pkgs;
  };
in {
  options.homelab.updates.enable = lib.mkEnableOption "Git reconciliation from main";

  config = lib.mkIf config.homelab.updates.enable {
    assertions = [{
      assertion = !(config.homelab.containers.enable || config.homelab.homeassistant.enable);
      message = "Comin enrollment currently supports base hosts only. Stateful services need a reviewed backup and deployment workflow before enabling automatic updates.";
    }];
    environment.etc."homelab/github_known_hosts".source = ../lib/github_known_hosts;

    services.comin = {
      enable = true;
      package = inputs.comin.packages.${pkgs.stdenv.hostPlatform.system}.comin;
      debug = false;
      hostname = config.networking.hostName;
      grpc = {
        unix_socket_group = "wheel";
        unix_socket_mode = "0600";
      };
      exporter.listen_address = "127.0.0.1";
      remotes = [{
        name = "origin";
        url = "git@github.com:0x63616c/homelab.git";
        branches.main.name = "main";
        poller.period = 600;
        auth = {
          username = "git";
          ssh_deploy_key_path = "/var/lib/homelab-git/key.txt";
          ssh_known_hosts_path = "/etc/homelab/github_known_hosts";
        };
      }];
    };

    # Every start, including Comin's own restart, passes through the enrollment
    # gate. Upstream launchd start calls cannot bypass the setup hold.
    launchd.daemons.comin = {
      command = lib.mkForce (lib.escapeShellArgs [
        "${hostTools}/bin/homelab-host"
        "run-updater"
        "--executable" "${config.services.comin.package}/bin/comin"
        "--config" "${cominConfiguration.cominConfigYaml}"
      ]);
      serviceConfig = {
        # Determinate owns Nix, so nix-darwin deliberately disables nix.package.
        EnvironmentVariables = lib.mkForce {
          PATH = "/nix/var/nix/profiles/default/bin:" + lib.makeBinPath [ pkgs.git pkgs.openssh ];
        };
        KeepAlive = lib.mkForce { SuccessfulExit = false; };
        # Comin exits successfully when its configuration changes. The interval
        # restarts that case without spinning while enrollment is held.
        StartInterval = 60;
        ThrottleInterval = 30;
      };
    };
  };
}
