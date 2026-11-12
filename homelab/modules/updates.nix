{ config, inputs, deploymentPolicy, lib, pkgs, ... }:
let
  hostTools = import ../packages/client.nix { inherit pkgs; };
  cominConfiguration = import (inputs.comin + "/nix/comin-config.nix") {
    inherit config lib pkgs;
  };
  transaction = pkgs.writeShellScriptBin "homelab-activate-generation" ''
    exec ${pkgs.python3}/bin/python3 ${../scripts}/stateful-activation.py "$@"
  '';
in {
  options.homelab.updates = {
    enable = lib.mkEnableOption "Git reconciliation from the deployment branch";
    stateful.enable = lib.mkEnableOption "reviewed transactional stateful activation";
  };

  config = lib.mkIf config.homelab.updates.enable {
    assertions = [{
      assertion = !(config.homelab.containers.enable || config.homelab.homeassistant.enable)
        || (config.homelab.updates.stateful.enable && config.homelab.backups.enable);
      message = "Stateful Comin requires explicit transactional activation and verified backup configuration.";
    }];
    environment.systemPackages = lib.optional config.homelab.updates.stateful.enable transaction;
    system.activationScripts.preActivation.text = lib.mkBefore (lib.optionalString
      (config.homelab.updates.stateful.enable && (config.homelab.containers.enable || config.homelab.homeassistant.enable)) ''
      ${transaction}/bin/homelab-activate-generation guard --candidate "$systemConfig"
    '');
    environment.etc."homelab/github_known_hosts".source = ../lib/github_known_hosts;

    services.comin = {
      enable = true;
      repositorySubdir = "homelab";
      # Pinned Comin otherwise advances only its private profile, leaving
      # nix-darwin's boot/RunAtLoad activation on the old configuration.
      package = inputs.comin.packages.${pkgs.stdenv.hostPlatform.system}.comin.overrideAttrs (old: {
        patches = (old.patches or []) ++ [ ../packages/comin-darwin-profile.patch ../packages/comin-stateful-activation.patch ];
        doCheck = true;
        checkPhase = ''
          runHook preCheck
          go test ./internal/profile ./internal/executor -count=1
          runHook postCheck
        '';
      });
      debug = false;
      hostname = config.networking.hostName;
      grpc = {
        # The native /run directory is group-writable on macOS. Keep RPC inside
        # the bootstrap-owned private directory, checked by the startup gate.
        unix_socket_path = "/var/lib/homelab/comin.sock";
        unix_socket_group = "wheel";
        unix_socket_mode = "0600";
      };
      exporter.listen_address = "127.0.0.1";
      remotes = [{
        name = "origin";
        url = "git@github.com:${deploymentPolicy.repository}.git";
        branches.main.name = deploymentPolicy.branch;
        poller.period = 30;
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
        AbandonProcessGroup = config.homelab.updates.stateful.enable;
        # Determinate owns Nix, so nix-darwin deliberately disables nix.package.
        EnvironmentVariables = lib.mkForce {
          # Darwin activation also invokes native tools such as grep by name.
          PATH = "/nix/var/nix/profiles/default/bin:"
            + lib.makeBinPath [ pkgs.git pkgs.openssh ]
            + ":/usr/bin:/bin:/usr/sbin:/sbin";
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
