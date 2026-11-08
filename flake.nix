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
    comin.url = "github:nlewo/comin/004a55ced41d72340373ebc6774e29a417512638";
    comin.inputs.nixpkgs.follows = "nixpkgs";
  };
  outputs = inputs@{ self, nixpkgs, darwin, ... }:
    let
      system = "aarch64-darwin";
      allowRunnerTools = pkg:
        builtins.elem (nixpkgs.lib.getName pkg) [ "tart" "softnet" ];
      pkgs = import nixpkgs {
        inherit system;
        config.allowUnfreePredicate = allowRunnerTools;
      };
      manifest = builtins.fromJSON (builtins.readFile ./homelab.json);
      runnerTools = import ./packages/runner-tools.nix { inherit pkgs; };
      mkHost = name: darwin.lib.darwinSystem {
        specialArgs = { inherit inputs; reviewedHost = manifest.hosts.${name}; };
        modules = [
          { nixpkgs.config.allowUnfreePredicate = allowRunnerTools; }
          inputs.nix-homebrew.darwinModules.nix-homebrew
          inputs.sops-nix.darwinModules.sops
          inputs.determinate.darwinModules.default
          inputs.comin.darwinModules.comin
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
        homelab-runner = import ./packages/runner.nix { inherit pkgs; };
      };
      devShells.${system}.default = pkgs.mkShellNoCC {
        packages = with pkgs; [
          (python3.withPackages (p: [ p.pyyaml ])) bash nixfmt
          cargo rustc rustfmt clippy
          git shellcheck nodejs age sops
        ];
      };
      darwinConfigurations = {
        homelab-macbook = mkHost "homelab-macbook";
        homelab-mac-mini = mkHost "homelab-mac-mini";
      };
      checks.${system} = {
        runner-concurrency-limits =
          let
            options = self.darwinConfigurations.homelab-macbook.options.homelab.runners;
          in
            assert options.maxConcurrentJobs.type.check 4;
            assert !(options.maxConcurrentJobs.type.check 5);
            assert options.tart.maxMacOSGuests.type.check 2;
            assert !(options.tart.maxMacOSGuests.type.check 3);
            pkgs.runCommand "homelab-runner-concurrency-limits-check" {} ''
              touch "$out"
            '';
        # Compile the enabled Linux path and fetch its pinned runner archive,
        # without booting a VM, registering a runner or enabling the real profile.
        runner-linux-profile = (self.darwinConfigurations.homelab-macbook.extendModules {
          modules = [({ lib, ... }: {
            homelab.runners.linux = {
              enable = lib.mkForce true;
              image = lib.mkForce "ghcr.io/test/linux@sha256:${lib.concatStrings (lib.replicate 64 "a")}";
              routingAuditApproved = lib.mkForce true;
            };
          })];
        }).system;
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
        runner-controller = self.packages.${system}.homelab-runner;
        runner-process-survival =
          let
            runnerConfig = (self.darwinConfigurations.homelab-macbook.extendModules {
              modules = [({ lib, ... }: {
                homelab.runners = {
                  enable = lib.mkForce true;
                  admissionEnabled = lib.mkForce false;
                  githubAppId = lib.mkForce "fixture";
                  image = lib.mkForce "ghcr.io/test/base@sha256:${lib.concatStrings (lib.replicate 64 "a")}";
                  repositories = lib.mkForce {
                    "test/repo" = {
                      repositoryId = 1;
                      installationId = 2;
                      runnerGroupId = 1;
                    };
                  };
                };
              })];
            }).config;
            plist = pkgs.writeText "homelab-runner-process-survival.plist"
              runnerConfig.environment.launchDaemons."org.nixos.homelab-runner.plist".text;
            expectedCommand = "/bin/wait4path /nix/store && exec "
              + runnerConfig.launchd.daemons.homelab-runner.command;
          in pkgs.runCommand "homelab-runner-process-survival-check" {} ''
            test "$(/usr/bin/plutil -extract ProgramArguments.0 raw -o - '${plist}')" = /bin/sh
            test "$(/usr/bin/plutil -extract ProgramArguments.1 raw -o - '${plist}')" = -c
            test "$(/usr/bin/plutil -extract ProgramArguments.2 raw -o - '${plist}')" = ${pkgs.lib.escapeShellArg expectedCommand}
            test "$(/usr/bin/plutil -extract AbandonProcessGroup raw -o - '${plist}')" = true
            test "$(/usr/bin/plutil -extract KeepAlive raw -o - '${plist}')" = true
            test "$(/usr/bin/plutil -extract ThrottleInterval raw -o - '${plist}')" = 30
            test "$(/usr/bin/plutil -extract UserName raw -o - '${plist}')" = _runner
            test "$(/usr/bin/plutil -extract GroupName raw -o - '${plist}')" = _runner
            test "$(/usr/bin/plutil -extract StandardOutPath raw -o - '${plist}')" = /dev/null
            test "$(/usr/bin/plutil -extract StandardErrorPath raw -o - '${plist}')" = /dev/null
            touch "$out"
          '';
        macbook = self.darwinConfigurations.homelab-macbook.system;
        mac-mini = self.darwinConfigurations.homelab-mac-mini.system;
        # Compile dormant service paths without enabling them on either host.
        # This builds launchd scripts and runs their generated ShellCheck checks.
        macbook-containers = (self.darwinConfigurations.homelab-macbook.extendModules {
          specialArgs.reviewedHost = manifest.hosts.homelab-macbook // {
            services = [ "bambuddy" "control-center" "hindsight" "cloudflared" "penpot" "home-assistant" ];
          };
          modules = [({ lib, ... }: {
            homelab.containers.enable = lib.mkForce true;
            homelab.containers.services = lib.mkForce [
              "bambuddy" "control-center" "hindsight" "cloudflared" "penpot"
            ];
            homelab.homeassistant.enable = true;
            # Compile only; this is not a claim about the MacBook's interface.
            homelab.homeassistant.bridgeInterface = "en0";
            homelab.backups.enable = true;
            homelab.updates.enable = lib.mkForce true;
            homelab.updates.stateful.enable = true;
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
