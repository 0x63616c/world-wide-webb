{
  description = "Disposable VM bootstrap rehearsal; never activate on physical hardware";
  inputs = {
    comin.url = "github:nlewo/comin/004a55ced41d72340373ebc6774e29a417512638";
    comin.inputs.nixpkgs.follows = "nixpkgs";
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    darwin.url = "github:nix-darwin/nix-darwin/master";
    darwin.inputs.nixpkgs.follows = "nixpkgs";
    determinate.url = "github:DeterminateSystems/determinate";
    sops-nix.url = "github:Mic92/sops-nix";
    sops-nix.inputs.nixpkgs.follows = "nixpkgs";
  };
  outputs = inputs@{ self, darwin, ... }:
    let
      fixture = builtins.fromJSON (builtins.readFile ./fixture.json);
      manifest = builtins.fromJSON (builtins.readFile ./homelab.json);
      reviewed = manifest.hosts.vm-test;
      host = darwin.lib.darwinSystem {
        modules = [
          inputs.comin.darwinModules.comin
          inputs.determinate.darwinModules.default
          inputs.sops-nix.darwinModules.sops
          ({ config, lib, pkgs, ... }:
          let
            helper = import ./helper.nix { inherit pkgs; };
            cominConfiguration = import (inputs.comin + "/nix/comin-config.nix") {
              inherit config lib pkgs;
            };
            fixtureTools = pkgs.runCommandCC "homelab-vm-fixture-tools" {
              nativeBuildInputs = [ pkgs.rustc ];
            } ''
              mkdir -p $out/bin
              cp ${./fixture-tools.rs} fixture-tools.rs
              cp ${./tailscale-status.json} tailscale-status.json
              rustc --edition=2024 fixture-tools.rs -o $out/bin/tailscale
              # Verification canonicalizes executables before running them.
              cp $out/bin/tailscale $out/bin/homelab-health
            '';
            keys = pkgs.writeText "vm-authorized-keys"
              (lib.concatStringsSep "\n" config.homelab.authorizedKeys + "\n");
          in {
            options.homelab = {
              adminUser = lib.mkOption { type = lib.types.str; };
              adminUID = lib.mkOption { type = lib.types.ints.positive; };
              authorizedKeys = lib.mkOption { type = lib.types.listOf lib.types.str; };
              activationReady = lib.mkOption { type = lib.types.bool; };
              services = lib.mkOption { type = lib.types.listOf lib.types.str; };
            };
            config = {
              homelab = reviewed;
              assertions = [{
                assertion = reviewed.adminUser == "admin" && reviewed.adminUID == 501
                  && reviewed.activationReady && reviewed.services == []
                  && builtins.length reviewed.authorizedKeys == 1
                  && fixture.repository != "REPLACE_WITH_OWNER/REPLACE_WITH_SYNTHETIC_REPOSITORY"
                  && builtins.match "[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+" fixture.repository != null
                  && manifest.tailscale.tag == "tag:vm-test"
                  && lib.hasPrefix "ssh-ed25519 " (builtins.head reviewed.authorizedKeys);
                message = "Replace the fixture placeholder with one disposable Ed25519 key.";
              }];
              nixpkgs.hostPlatform = "aarch64-darwin";
              system.stateVersion = 6;
              system.configurationRevision = self.rev or (throw "Publish an exact clean synthetic fixture commit.");
              system.primaryUser = config.homelab.adminUser;
              networking.hostName = "vm-test";
              nix.enable = false;
              determinateNix.enable = true;
              # Adopt only the untouched default written by the pinned Determinate installer.
              # Any custom content still requires manual review before activation.
              environment.etc."nix/nix.custom.conf".knownSha256Hashes = [
                "3bd68ef979a42070a44f8d82c205cfd8e8cca425d91253ec2c10a88179bb34aa"
              ];
              environment.systemPackages = [
                pkgs.git pkgs.sops
                helper fixtureTools
              ];
              services.openssh.enable = true;
              services.openssh.extraConfig = ''
                PubkeyAuthentication yes
                PasswordAuthentication no
                KbdInteractiveAuthentication no
                PermitRootLogin no
                AuthenticationMethods publickey
                AllowUsers admin
                AuthorizedKeysFile /etc/ssh/authorized_keys/%u
              '';
              # StrictModes requires a real key file outside the group-writable store.
              system.activationScripts.etc.text = lib.mkAfter ''
                ${helper}/bin/homelab-host install-ssh-keys --user admin --source ${keys}
              '';
              environment.etc."homelab-vm-e2e.json".text = builtins.toJSON {
                host = "vm-test";
                revision = self.rev or (throw "Publish the prepared fixture as an exact clean Git commit.");
              };
              environment.etc."homelab/revision.json".text = builtins.toJSON {
                repository = fixture.repository;
                host = "vm-test";
                revision = config.system.configurationRevision;
              };
              environment.etc."homelab/deployment.json".text = builtins.toJSON {
                host = "vm-test";
                revision = config.system.configurationRevision;
                services = [];
                backupsEnabled = false;
              };
              environment.etc."homelab/github_known_hosts".source = ./github_known_hosts;
              services.comin = {
                enable = true;
                package = inputs.comin.packages.${pkgs.stdenv.hostPlatform.system}.comin;
                hostname = "vm-test";
                grpc = { unix_socket_group = "wheel"; unix_socket_mode = "0600"; };
                exporter.listen_address = "127.0.0.1";
                remotes = [{
                  name = "origin";
                  url = "git@github.com:${fixture.repository}.git";
                  branches.main.name = "main";
                  poller.period = 600;
                  auth = {
                    username = "git";
                    ssh_deploy_key_path = "/var/lib/homelab-git/key.txt";
                    ssh_known_hosts_path = "/etc/homelab/github_known_hosts";
                  };
                }];
              };
              # Every start uses the real enrollment gate. Nix never fabricates or
              # releases the bootstrap-owned hold or completion receipt.
              launchd.daemons.comin = {
                command = lib.mkForce (lib.escapeShellArgs [
                  "${helper}/bin/homelab-host" "run-updater"
                  "--executable" "${config.services.comin.package}/bin/comin"
                  "--config" "${cominConfiguration.cominConfigYaml}"
                ]);
                serviceConfig = {
                  EnvironmentVariables = lib.mkForce {
                    PATH = "/nix/var/nix/profiles/default/bin:" + lib.makeBinPath [ pkgs.git pkgs.openssh ];
                  };
                  KeepAlive = lib.mkForce { SuccessfulExit = false; };
                  StartInterval = 60;
                  ThrottleInterval = 30;
                };
              };
              sops.age = {
                keyFile = "/var/lib/sops-nix/key.txt";
                generateKey = false;
                sshKeyPaths = [];
              };
              sops.gnupg.sshKeyPaths = [];
              sops.defaultSopsFile = ./secrets/vm-test.sops.yaml;
              sops.secrets.vm-rehearsal-marker.mode = "0400";
              system.activationScripts.preActivation.text = lib.mkBefore
                (builtins.readFile ./assert-guest.sh);
              launchd.daemons.vm-e2e = {
                command = "${pkgs.writeShellScript "homelab-vm-boot" (builtins.readFile ./boot-sentinel.sh)}";
                serviceConfig = {
                  Label = "org.homelab.vm-e2e";
                  # Secret installation and this job have no launchd ordering guarantee.
                  KeepAlive.SuccessfulExit = false;
                  ThrottleInterval = 5;
                  RunAtLoad = true;
                  UserName = "root";
                };
              };
            };
          })
        ];
      };
    in {
      darwinConfigurations.vm-test = host;
      # Read the evaluated settings, not a second copy of approval metadata.
      lib.setupPlan.hosts.vm-test = {
        inherit (host.config.homelab) adminUser adminUID authorizedKeys activationReady services;
      };
      checks.aarch64-darwin.vm-test = host.system;
      checks.aarch64-darwin.completion-contract = host.pkgs.runCommand "vm-completion-contract" {
        nativeBuildInputs = [ host.pkgs.jq host.pkgs.coreutils ];
      } ''
        jq -e --arg repository '${fixture.repository}' --arg revision '${self.rev}' \
          '.repository == $repository and .host == "vm-test" and .revision == $revision' \
          ${host.system}/etc/homelab/revision.json
        # The verifier canonicalizes paths, so health must retain its own name.
        test "$(basename "$(realpath ${host.system}/sw/bin/homelab-health)")" = homelab-health
        test "$(basename "$(realpath ${host.system}/sw/bin/tailscale)")" = tailscale
        touch "$out"
      '';
    };
}
