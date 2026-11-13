inputs@{
  self,
  nixpkgs,
  darwin,
  ...
}:
let
  system = "aarch64-darwin";
  allowUnfreePackages =
    pkg:
    builtins.elem (nixpkgs.lib.getName pkg) [
      "tart"
      "softnet"
      "rex"
      "claude-code"
    ];
  pkgs = import nixpkgs {
    inherit system;
    config.allowUnfreePredicate = allowUnfreePackages;
  };
  manifest = builtins.fromJSON (builtins.readFile ./homelab.json);
  deploymentPolicy =
    assert manifest.schema == 3;
    assert manifest.deployment.repository == "0x63616c/world-wide-webb";
    assert manifest.deployment.branch == "deploy/homelab";
    manifest.deployment;
  runnerTools = import ./packages/runner-tools.nix { inherit pkgs; };
  mkHost =
    name:
    darwin.lib.darwinSystem {
      specialArgs = {
        inherit inputs deploymentPolicy;
        reviewedHost = manifest.hosts.${name};
      };
      modules = [
        { nixpkgs.config.allowUnfreePredicate = allowUnfreePackages; }
        inputs.nix-homebrew.darwinModules.nix-homebrew
        inputs.sops-nix.darwinModules.sops
        inputs.determinate.darwinModules.default
        inputs.comin.darwinModules.comin
        ./modules/manifest.nix
        ./modules/base.nix
        ./modules/users.nix
        ./modules/ssh.nix
        ./modules/power.nix
        ./modules/tailscale.nix
        ./modules/secrets.nix
        ./modules/containers.nix
        ./modules/runners.nix
        ./modules/homeassistant.nix
        ./modules/updates.nix
        ./modules/operations.nix
        ./modules/backups.nix
        ./modules/health.nix
        ./modules/monitoring.nix
        (./hosts + "/${name}.nix")
      ];
    };
in
{
  lib.setupPlan = import ./lib/setup-plan.nix {
    revision = self.rev or null;
    hosts = self.darwinConfigurations;
  };
  packages.${system} = runnerTools // {
    homelab = import ./packages/client.nix { inherit pkgs; };
    homelab-host-ops = import ./packages/host.nix { inherit pkgs; };
    homelab-runner = import ./packages/runner.nix { inherit pkgs; };
    beszel-agent = import ./packages/beszel-agent.nix { inherit pkgs; };
    rex = import ./packages/rex.nix { inherit pkgs; };
    claude-code = import ./packages/claude-code.nix { inherit pkgs; };
  };
  devShells.${system}.default = pkgs.mkShellNoCC {
    packages = with pkgs; [
      (python3.withPackages (p: [ p.pyyaml ]))
      bash
      nixfmt
      cargo
      rustc
      rustfmt
      clippy
      git
      shellcheck
      nodejs
      age
      sops
    ];
  };
  darwinConfigurations = {
    homelab-macbook = mkHost "homelab-macbook";
    homelab-mac-mini = mkHost "homelab-mac-mini";
  };
  checks.${system} = {
    coding-account =
      let
        book = self.darwinConfigurations.homelab-macbook.config;
        mini = self.darwinConfigurations.homelab-mac-mini.config;
        coding = book.users.users.coding;
      in
      assert coding.uid == 502 && coding.gid == 20;
      assert coding.home == "/Users/coding" && coding.createHome;
      assert coding.shell == pkgs.zsh && !coding.isHidden;
      assert builtins.elem "coding" book.users.knownUsers;
      assert book.homelab.sshUsers.coding == book.homelab.authorizedKeys;
      assert pkgs.lib.hasInfix "AllowUsers admin coding" book.services.openssh.extraConfig;
      assert pkgs.lib.hasInfix "PasswordAuthentication no" book.services.openssh.extraConfig;
      assert pkgs.lib.hasInfix "--user ${pkgs.lib.escapeShellArg "coding"}"
        book.system.activationScripts.etc.text;
      assert pkgs.lib.hasInfix "coding must not be an administrator"
        book.system.activationScripts.preActivation.text;
      assert pkgs.lib.hasInfix "/Users/coding UniqueID" book.system.activationScripts.preActivation.text;
      assert pkgs.lib.hasInfix "-a coding -t user com.apple.access_ssh"
        book.system.activationScripts.users.text;
      assert !(mini.users.users ? coding) && mini.homelab.sshUsers == { };
      assert pkgs.lib.hasInfix "AllowUsers admin\n" mini.services.openssh.extraConfig;
      pkgs.runCommand "homelab-coding-account-check" { } ''touch "$out"'';
    deployment-inputs =
      let
        base = self.darwinConfigurations.homelab-mac-mini;
        inputsFor = host: builtins.fromJSON host.config.environment.etc."homelab/deployment.json".text;
        original = inputsFor base;
        monitor = inputsFor (
          base.extendModules {
            modules = [
              ({ lib, ... }: {
                homelab.monitoring.agent.listenAddress = lib.mkForce "100.100.100.100";
              })
            ];
          }
        );
        worker = inputsFor (
          base.extendModules {
            modules = [
              ({ lib, ... }: {
                homelab.containers.controlCenter.workersEnabled = lib.mkForce false;
              })
            ];
          }
        );
      in
      assert original.inputs == monitor.inputs;
      assert
        original.inputs.services.control-center.configuration
        != worker.inputs.services.control-center.configuration;
      assert original.inputs.services.hindsight == worker.inputs.services.hindsight;
      pkgs.runCommand "homelab-deployment-inputs-check" { } ''touch "$out"'';
    beszel-agent = self.packages.${system}.beszel-agent;
    rex = self.packages.${system}.rex;
    claude-code = self.packages.${system}.claude-code;
    beszel-agent-settings =
      let
        options = self.darwinConfigurations.homelab-macbook.options.homelab.monitoring.agent;
        address = options.listenAddress.type;
        key = options.publicKey.type;
        fixtures =
          map
            (
              name:
              (self.darwinConfigurations.${name}.extendModules {
                modules = [
                  ({ lib, ... }: {
                    homelab.monitoring.agent = {
                      enable = lib.mkForce true;
                      listenAddress = lib.mkForce "100.100.100.100";
                      publicKey = lib.mkForce "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
                    };
                  })
                ];
              }).config
            )
            [
              "homelab-macbook"
              "homelab-mac-mini"
            ];
        valid =
          cfg:
          let
            daemon = cfg.launchd.daemons.homelab-beszel-agent;
            service = daemon.serviceConfig;
            env = service.EnvironmentVariables;
          in
          service.UserName == "_monitor"
          && service.GroupName == "_monitor"
          && cfg.users.users._monitor.uid == 452
          && cfg.users.groups._monitor.gid == 452
          && service.RunAtLoad
          && service.KeepAlive
          && service.ThrottleInterval == 30
          && service.Umask == 63
          && service.WorkingDirectory == "/var/lib/_monitor"
          && service.StandardOutPath == "/dev/null"
          && service.StandardErrorPath == "/dev/null"
          && env.LISTEN == "100.100.100.100:45876"
          && env.DATA_DIR == "/var/lib/_monitor"
          && env.CHECK_UPDATES == "false"
          &&
            builtins.attrNames env == [
              "CHECK_UPDATES"
              "DATA_DIR"
              "HOME"
              "KEY"
              "LISTEN"
              "PATH"
            ]
          && daemon.command != "";
        plists = map (
          cfg:
          pkgs.writeText "homelab-beszel-agent.plist"
            cfg.environment.launchDaemons."org.nixos.homelab-beszel-agent.plist".text
        ) fixtures;
      in
      assert address.check "100.64.0.1" && address.check "100.127.255.254";
      assert builtins.all (value: !(address.check value)) [
        "0.0.0.0"
        "::"
        "127.0.0.1"
        "192.168.1.1"
        "100.63.0.1"
        "100.128.0.1"
        "100.100.100.256"
        "100.100.100.100:45876"
        "node.example.ts.net"
      ];
      assert
        !(key.check "") && !(key.check "private-key") && !(key.check "ssh-ed25519 abc\nTOKEN=secret");
      assert builtins.all valid fixtures;
      pkgs.runCommand "homelab-beszel-agent-settings-check" { } ''
        for plist in ${pkgs.lib.concatStringsSep " " (map toString plists)}; do
          test "$(/usr/bin/plutil -extract ProgramArguments.0 raw -o - "$plist")" = /bin/sh
          test "$(/usr/bin/plutil -extract ProgramArguments.1 raw -o - "$plist")" = -c
          /usr/bin/plutil -extract ProgramArguments.2 raw -o - "$plist" | /usr/bin/grep -q '^/bin/wait4path /nix/store && exec '
          test "$(/usr/bin/plutil -extract UserName raw -o - "$plist")" = _monitor
        done
        touch "$out"
      '';
    macbook-monitoring =
      (self.darwinConfigurations.homelab-macbook.extendModules {
        modules = [
          ({ lib, ... }: {
            homelab.monitoring.agent = {
              enable = lib.mkForce true;
              listenAddress = lib.mkForce "100.100.100.100";
              publicKey = lib.mkForce "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
            };
          })
        ];
      }).system;
    mac-mini-monitoring =
      (self.darwinConfigurations.homelab-mac-mini.extendModules {
        modules = [
          ({ lib, ... }: {
            homelab.monitoring.agent = {
              enable = lib.mkForce true;
              listenAddress = lib.mkForce "100.100.100.100";
              publicKey = lib.mkForce "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
            };
          })
        ];
      }).system;
    runner-concurrency-limits =
      let
        options = self.darwinConfigurations.homelab-macbook.options.homelab.runners;
      in
      assert options.maxConcurrentJobs.type.check 4;
      assert !(options.maxConcurrentJobs.type.check 5);
      assert options.tart.maxMacOSGuests.type.check 2;
      assert !(options.tart.maxMacOSGuests.type.check 3);
      pkgs.runCommand "homelab-runner-concurrency-limits-check" { } ''
        touch "$out"
      '';
    # Compile the enabled Linux path and fetch its pinned runner archive,
    # without booting a VM, registering a runner or enabling the real profile.
    runner-linux-profile =
      (self.darwinConfigurations.homelab-macbook.extendModules {
        modules = [
          ({ lib, ... }: {
            homelab.runners.linux = {
              enable = lib.mkForce true;
              image = lib.mkForce "ghcr.io/test/linux@sha256:${lib.concatStrings (lib.replicate 64 "a")}";
              routingAuditApproved = lib.mkForce true;
            };
          })
        ];
      }).system;
    service-assignments =
      let
        haOnly =
          (self.darwinConfigurations.homelab-macbook.extendModules {
            specialArgs.reviewedHost = manifest.hosts.homelab-macbook // {
              services = [ "home-assistant" ];
            };
            modules = [
              ({ lib, ... }: {
                homelab.containers.enable = lib.mkForce false;
                homelab.containers.services = lib.mkForce [ "bambuddy" ];
                homelab.homeassistant.enable = true;
                homelab.homeassistant.bridgeInterface = "en0";
              })
            ];
          }).config;
        deployment = builtins.fromJSON haOnly.environment.etc."homelab/deployment.json".text;
        plan = import ./lib/setup-plan.nix {
          revision = "fixture";
          hosts.example.config = haOnly;
        };
      in
      assert deployment.services == [ "home-assistant" ];
      assert plan.hosts.example.services == deployment.services;
      pkgs.runCommand "homelab-service-assignments-check" { } ''
        touch "$out"
      '';
    management-client = self.packages.${system}.homelab;
    host-operations = self.packages.${system}.homelab-host-ops;
    runner-tart = runnerTools.tart;
    runner-softnet = runnerTools.softnet;
    runner-controller = self.packages.${system}.homelab-runner;
    runner-process-survival =
      let
        runnerConfig =
          (self.darwinConfigurations.homelab-macbook.extendModules {
            modules = [
              ({ lib, ... }: {
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
              })
            ];
          }).config;
        plist =
          pkgs.writeText "homelab-runner-process-survival.plist"
            runnerConfig.environment.launchDaemons."org.nixos.homelab-runner.plist".text;
        expectedCommand =
          "/bin/wait4path /nix/store && exec " + runnerConfig.launchd.daemons.homelab-runner.command;
      in
      pkgs.runCommand "homelab-runner-process-survival-check" { } ''
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
    macbook-containers =
      (self.darwinConfigurations.homelab-macbook.extendModules {
        specialArgs.reviewedHost = manifest.hosts.homelab-macbook // {
          services = [
            "bambuddy"
            "control-center"
            "hindsight"
            "cloudflared"
            "penpot"
            "home-assistant"
          ];
        };
        modules = [
          ({ lib, ... }: {
            homelab.containers.enable = lib.mkForce true;
            homelab.containers.services = lib.mkForce [
              "bambuddy"
              "control-center"
              "hindsight"
              "cloudflared"
              "penpot"
            ];
            # Compile only: validate the registry entry against its actual owner's
            # ciphertext, without provisioning that credential on the MacBook.
            sops.secrets."registry/config.json".sopsFile = ./secrets/homelab-mac-mini.sops.yaml;
            homelab.homeassistant.enable = true;
            # Compile only; this is not a claim about the MacBook's interface.
            homelab.homeassistant.bridgeInterface = "en0";
            homelab.backups.enable = true;
            homelab.updates.enable = lib.mkForce true;
            homelab.updates.stateful.enable = true;
          })
        ];
      }).system;
    compose =
      pkgs.runCommand "homelab-compose-check"
        {
          nativeBuildInputs = [
            pkgs.docker-compose
            pkgs.python3
          ];
        }
        ''
          python3 ${./scripts/check-compose.py} ${./services}
          touch "$out"
        '';
    sops-host-identity =
      pkgs.runCommand "homelab-sops-host-identity-check"
        {
          nativeBuildInputs = [
            pkgs.bash
            pkgs.age
            pkgs.sops
          ];
        }
        ''
          bash ${./scripts/check-sops.sh} ${self.packages.${system}.homelab}/bin/homelab-host
          touch "$out"
        '';
  };
  formatter.${system} = pkgs.nixfmt;
}
