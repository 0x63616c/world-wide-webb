{
  description = "Calum's declarative macOS homelab";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    darwin.url = "github:nix-darwin/nix-darwin/master";
    darwin.inputs.nixpkgs.follows = "nixpkgs";
    nix-homebrew.url = "github:zhaofengli/nix-homebrew";
    sops-nix.url = "github:Mic92/sops-nix";
    sops-nix.inputs.nixpkgs.follows = "nixpkgs";
    determinate.url = "github:DeterminateSystems/determinate";
  };
  outputs = inputs@{ self, nixpkgs, darwin, ... }:
    let
      system = "aarch64-darwin";
      pkgs = import nixpkgs {
        inherit system;
        config.allowUnfreePredicate = pkg:
          builtins.elem (nixpkgs.lib.getName pkg) [ "tart" "softnet" ];
      };
      manifest = builtins.fromJSON (builtins.readFile ./homelab.json);
      runnerTools = import ./packages/runner-tools.nix { inherit pkgs; };
      mkHost = name: darwin.lib.darwinSystem {
        specialArgs = { inherit inputs; reviewedHost = manifest.hosts.${name}; };
        modules = [
          inputs.nix-homebrew.darwinModules.nix-homebrew
          inputs.sops-nix.darwinModules.sops
          inputs.determinate.darwinModules.default
          ./modules/manifest.nix
          ./modules/base.nix ./modules/users.nix ./modules/ssh.nix
          ./modules/power.nix ./modules/tailscale.nix ./modules/secrets.nix
          ./modules/containers.nix ./modules/runners.nix
          ./modules/homeassistant.nix ./modules/updates.nix
          ./modules/operations.nix
          ./modules/backups.nix
          ./modules/health.nix
          (./hosts + "/${name}.nix")
        ];
      };
    in {
      lib.setupPlan = import ./lib/setup-plan.nix {
        revision = self.rev or null;
        hosts = self.darwinConfigurations;
      };
      packages.${system} = runnerTools // {
        homelab = import ./packages/client.nix { inherit pkgs; };
      };
      devShells.${system}.default = pkgs.mkShellNoCC {
        packages = with pkgs; [
          python3 bash nixfmt
          cargo rustc rustfmt clippy
          git shellcheck nodejs age sops
        ];
      };
      darwinConfigurations = {
        homelab-macbook = mkHost "homelab-macbook";
        homelab-mac-mini = mkHost "homelab-mac-mini";
      };
      checks.${system} = {
        service-assignments =
          let
            haOnly = (self.darwinConfigurations.homelab-macbook.extendModules {
              specialArgs.reviewedHost = manifest.hosts.homelab-macbook // { services = [ "home-assistant" ]; };
              modules = [({ lib, ... }: {
                homelab.containers.enable = lib.mkForce false;
                homelab.containers.services = lib.mkForce [ "bambuddy" ];
                homelab.homeassistant.enable = true;
                homelab.homeassistant.bridgeInterface = "en0";
              })];
            }).config;
            deployment = builtins.fromJSON haOnly.environment.etc."homelab/deployment.json".text;
            plan = import ./lib/setup-plan.nix {
              revision = "fixture";
              hosts.example.config = haOnly;
            };
          in
            assert deployment.services == [ "home-assistant" ];
            assert plan.hosts.example.services == deployment.services;
            pkgs.runCommand "homelab-service-assignments-check" {} ''
              touch "$out"
            '';
        management-client = self.packages.${system}.homelab;
        runner-tart = runnerTools.tart;
        runner-softnet = runnerTools.softnet;
        macbook = self.darwinConfigurations.homelab-macbook.system;
        mac-mini = self.darwinConfigurations.homelab-mac-mini.system;
        # Compile dormant service paths without enabling them on either host.
        # This builds launchd scripts and runs their generated ShellCheck checks.
        macbook-containers = (self.darwinConfigurations.homelab-macbook.extendModules {
          specialArgs.reviewedHost = manifest.hosts.homelab-macbook // {
            services = [ "bambuddy" "control-center" "hindsight" "cloudflared" "home-assistant" ];
          };
          modules = [({ lib, ... }: {
            homelab.containers.enable = lib.mkForce true;
            homelab.containers.services = lib.mkForce [
              "bambuddy" "control-center" "hindsight" "cloudflared"
            ];
            homelab.homeassistant.enable = true;
            # Compile only; this is not a claim about the MacBook's interface.
            homelab.homeassistant.bridgeInterface = "en0";
            homelab.backups.enable = true;
            homelab.updates.enable = lib.mkForce true;
          })];
        }).system;
        compose = pkgs.runCommand "homelab-compose-check" {
          nativeBuildInputs = [ pkgs.docker-compose pkgs.python3 ];
        } ''
          python3 ${./scripts/check-compose.py} ${./services}
          touch "$out"
        '';
        sops-host-identity = pkgs.runCommand "homelab-sops-host-identity-check" {
          nativeBuildInputs = [ pkgs.bash pkgs.age pkgs.sops ];
        } ''
          bash ${./scripts/check-sops.sh} ${self.packages.${system}.homelab}/bin/homelab-host
          touch "$out"
        '';
      };
      formatter.${system} = pkgs.nixfmt;
    };
}
