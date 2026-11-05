{
  description = "Disposable VM bootstrap rehearsal; never activate on physical hardware";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    darwin.url = "github:nix-darwin/nix-darwin/master";
    darwin.inputs.nixpkgs.follows = "nixpkgs";
    determinate.url = "github:DeterminateSystems/determinate";
    sops-nix.url = "github:Mic92/sops-nix";
    sops-nix.inputs.nixpkgs.follows = "nixpkgs";
  };
  outputs = inputs@{ self, darwin, ... }:
    let
      manifest = builtins.fromJSON (builtins.readFile ./homelab.json);
      reviewed = manifest.hosts.vm-test;
      host = darwin.lib.darwinSystem {
        modules = [
          inputs.determinate.darwinModules.default
          inputs.sops-nix.darwinModules.sops
          ({ config, lib, pkgs, ... }: {
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
                  && lib.hasPrefix "ssh-ed25519 " (builtins.head reviewed.authorizedKeys);
                message = "Replace the fixture placeholder with one disposable Ed25519 key.";
              }];
              nixpkgs.hostPlatform = "aarch64-darwin";
              system.stateVersion = 6;
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
                (import ./helper.nix { inherit pkgs; })
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
              environment.etc."ssh/authorized_keys/admin".text =
                lib.concatStringsSep "\n" config.homelab.authorizedKeys + "\n";
              environment.etc."homelab-vm-e2e.json".text = builtins.toJSON {
                host = "vm-test";
                revision = self.rev or (throw "Publish the prepared fixture as an exact clean Git commit.");
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
    };
}
