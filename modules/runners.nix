{ config, lib, pkgs, ... }:
let
  cfg = config.homelab.runners;
  package = import ../packages/runner.nix { inherit pkgs; };
  tools = import ../packages/runner-tools.nix { inherit pkgs; };
  stateDirectory = "/var/lib/_runner/controller";
  controlDirectory = "/var/lib/homelab-runner-control";
  helperDirectory = "/var/lib/homelab-runner-helpers/${builtins.baseNameOf tools.softnet.outPath}";
  settings = pkgs.writeText "homelab-runner.json" (builtins.toJSON {
    policy = {
      host_name = config.networking.hostName;
      admission_enabled = cfg.admissionEnabled;
      max_concurrent_jobs = cfg.maxConcurrentJobs;
      max_macos_guests = cfg.tart.maxMacOSGuests;
      cpu_budget = cfg.cpuBudget;
      memory_budget_mib = cfg.memoryBudgetMiB;
      linux = if cfg.linux.enable then {
        image = cfg.linux.image;
        cpu = cfg.linux.cpu;
        memory_mib = cfg.linux.memoryMiB;
        disk_growth_bytes = cfg.linux.diskGrowthBytes;
        routing_audit_approved = cfg.linux.routingAuditApproved;
        runner_archive = "${package.linuxRunnerArchive}";
        runner_version = package.runnerVersion;
      } else null;
      repositories = lib.mapAttrsToList (name: repository: {
        owner = builtins.elemAt (lib.splitString "/" name) 0;
        name = builtins.elemAt (lib.splitString "/" name) 1;
        repository_id = repository.repositoryId;
        installation_id = repository.installationId;
        runner_group_id = repository.runnerGroupId;
        trust_approved = repository.trustApproved;
      }) cfg.repositories;
      image = cfg.image;
      cpu = cfg.cpu;
      memory_mib = cfg.memoryMiB;
      admission_free_bytes = cfg.admissionFreeBytes;
      emergency_free_bytes = cfg.emergencyFreeBytes;
      deadlines = {
        boot_seconds = 600;
        unassigned_seconds = 300;
        running_seconds = cfg.jobTimeoutSeconds;
        retry_seconds = 30;
      };
    };
    app_id = cfg.githubAppId;
    app_key_file = config.sops.secrets.runner-github-app-key.path;
    state_directory = stateDirectory;
    control_directory = controlDirectory;
    keychain = {
      service_uid = 451;
      service_home = "/var/lib/_runner";
      password_file = config.sops.secrets.runner-keychain-password.path;
    };
    tart = {
      binary = "${tools.tart}/bin/tart";
      home = "/var/lib/_runner";
      tart_home = "/var/lib/_runner/tart";
      helper_directory = helperDirectory;
      guest_helper = "${package}/bin/homelab-runner-guest";
      runner_archive = "${package.runnerArchive}";
      runner_version = package.runnerVersion;
    };
  });
  repositoryType = lib.types.submodule {
    options = {
      repositoryId = lib.mkOption { type = lib.types.ints.positive; };
      installationId = lib.mkOption { type = lib.types.ints.positive; };
      runnerGroupId = lib.mkOption { type = lib.types.ints.positive; };
      trustApproved = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Enable only after reviewing collaborators, PR policy and existing runnable workflows.";
      };
    };
  };
in {
  options.homelab.runners = {
    enable = lib.mkEnableOption "the disposable Tart runner controller";
    admissionEnabled = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Allow new jobs. Disabling admission keeps the daemon available to finish cleanup.";
    };
    maxConcurrentJobs = lib.mkOption {
      type = lib.types.ints.between 1 4;
      default = 1;
      description = "Shared macOS/Linux job capacity, at most four attempts.";
    };
    tart.maxMacOSGuests = lib.mkOption {
      type = lib.types.ints.between 1 2;
      default = 1;
      description = "macOS guest capacity per physical Mac (one or two).";
    };
    cpuBudget = lib.mkOption { type = lib.types.ints.positive; default = 12; };
    memoryBudgetMiB = lib.mkOption { type = lib.types.ints.positive; default = 24576; };
    linux = {
      enable = lib.mkEnableOption "digest-pinned disposable Linux ARM64 guests";
      image = lib.mkOption { type = lib.types.str; default = ""; };
      routingAuditApproved = lib.mkOption {
        type = lib.types.bool; default = false;
        description = "Every runnable allowlisted workflow has unambiguous platform routing.";
      };
      cpu = lib.mkOption { type = lib.types.ints.between 1 8; default = 2; };
      memoryMiB = lib.mkOption { type = lib.types.ints.between 1024 16384; default = 4096; };
      diskGrowthBytes = lib.mkOption {
        type = lib.types.ints.positive; default = 25769803776;
        description = "Conservative full per-attempt growth reservation; measure before enabling.";
      };
    };
    githubAppId = lib.mkOption { type = lib.types.str; default = ""; };
    repositories = lib.mkOption {
      type = lib.types.attrsOf repositoryType;
      default = {};
      description = "Repository allowlist, keyed by owner/name. App installation access must match.";
    };
    image = lib.mkOption {
      type = lib.types.str;
      default = "";
      description = "Reviewed macOS runner image pinned with @sha256: digest.";
    };
    cpu = lib.mkOption { type = lib.types.ints.between 1 8; default = 4; };
    memoryMiB = lib.mkOption { type = lib.types.ints.between 1024 16384; default = 8192; };
    admissionFreeBytes = lib.mkOption {
      type = lib.types.ints.positive;
      default = 236223201280; # 220 GiB; provisional until the selected image is measured.
    };
    emergencyFreeBytes = lib.mkOption { type = lib.types.ints.positive; default = 85899345920; };
    jobTimeoutSeconds = lib.mkOption { type = lib.types.ints.positive; default = 7200; };
  };

  config = lib.mkMerge [
    {
      # This applies even when removing the runner service in the new generation.
      # Replacing launchd jobs before idle would interrupt a running build.
      system.activationScripts.preActivation.text = lib.mkBefore ''
        if /bin/launchctl print system/org.nixos.homelab-runner >/dev/null 2>&1; then
          '${package}/bin/homelab-runner' drain --state-directory '${stateDirectory}' --control-directory '${controlDirectory}' --timeout-seconds 7800
        elif [ -e '${stateDirectory}/journal.json' ]; then
          '${package}/bin/homelab-runner' drain --offline --state-directory '${stateDirectory}' --control-directory '${controlDirectory}'
        elif ${lib.boolToString cfg.enable}; then
          '${package}/bin/homelab-runner' hold --state-directory '${stateDirectory}' --control-directory '${controlDirectory}'
        fi
      '';
      system.activationScripts.postActivation.text = lib.mkAfter ''
        if [ -e '${controlDirectory}/hold.json' ]; then
          '${package}/bin/homelab-runner' release --state-directory '${stateDirectory}' --control-directory '${controlDirectory}'
        fi
      '';
      assertions = [
        { assertion = !cfg.linux.enable || (cfg.linux.routingAuditApproved
            && builtins.match ".+@sha256:[0-9a-f]{64}" cfg.linux.image != null);
          message = "Linux admission requires a digest-pinned image and completed workflow routing audit."; }
        { assertion = lib.all (name: builtins.length (lib.splitString "/" name) == 2)
            (builtins.attrNames cfg.repositories);
          message = "Runner repository names must use owner/name."; }
      ];
    }
    (lib.mkIf cfg.enable {
      assertions = [
        { assertion = cfg.githubAppId != "" && cfg.repositories != {};
          message = "Runner enrollment requires a dedicated GitHub App and repository allowlist."; }
        { assertion = builtins.match ".+@sha256:[0-9a-f]{64}" cfg.image != null;
          message = "Runner image must be pinned to its reviewed OCI digest."; }
        { assertion = cfg.admissionFreeBytes > cfg.emergencyFreeBytes;
          message = "Runner admission reserve must exceed its emergency storage floor."; }
      ];
      environment.systemPackages = [ package tools.tart ];
      environment.etc."homelab/runner.json".source = settings;
      environment.etc."homelab/linux/cache-image.py".source = ../runner/images/linux/cache-image.py;
      sops.secrets.runner-github-app-key = {
        key = "runners/github-app-private-key";
        owner = "_runner";
        group = "_runner";
        mode = "0400";
      };
      sops.secrets.runner-keychain-password = {
        key = "runners/keychain-password";
        owner = "_runner";
        group = "_runner";
        mode = "0400";
      };
      launchd.daemons.homelab-runner = {
        # nix-darwin's command abstraction uses native /bin/sh + wait4path before
        # its own exec, so launchd can start while the Nix volume is still mounting.
        command = lib.escapeShellArgs [
          "${package}/bin/homelab-runner" "run" "--config" "/etc/homelab/runner.json"
        ];
        serviceConfig = {
          UserName = "_runner";
          GroupName = "_runner";
          SessionCreate = true;
          EnvironmentVariables = { HOME = "/var/lib/_runner"; PATH = "/usr/bin:/bin:/usr/sbin:/sbin"; };
          WorkingDirectory = "/var/lib/_runner";
          RunAtLoad = true;
          KeepAlive = true;
          # launchd otherwise kills Tart/Softnet when the controller dies. The
          # replacement controller reconciles the durable attempt and its lease.
          # Explicit service removal still passes the idle/drain activation gate.
          AbandonProcessGroup = true;
          ThrottleInterval = 30;
          Umask = 63;
          StandardOutPath = "/dev/null";
          StandardErrorPath = "/dev/null";
        };
      };
      # The helper drops privilege after vmnet setup. Versioned root-owned storage
      # prevents the service account replacing a setuid executable or its parents.
      system.activationScripts.users.text = lib.mkAfter ''
        '${package}/bin/homelab-runner' provision --softnet-source '${tools.softnet}/bin/softnet' --helper-directory '${helperDirectory}'
      '';
    })
  ];
}
