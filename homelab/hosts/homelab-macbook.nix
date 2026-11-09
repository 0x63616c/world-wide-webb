{ lib, ... }: {
  networking.hostName = "homelab-macbook";
  # tailscaled's confined DNS writer rejects a symlink out of /etc/resolver.
  environment.etc."resolver/ts.net".enable = lib.mkForce false;
  # Idle sleep settings alone did not keep the closed-lid node awake on AC.
  launchd.daemons.homelab-awake.serviceConfig = {
    ProgramArguments = [ "/usr/bin/caffeinate" "-s" ];
    UserName = "root";
    RunAtLoad = true;
    KeepAlive = true;
    ThrottleInterval = 30;
  };
  # Owner reports M2 / 32 GB / approximately 500 GB / macOS 27.2. Check free space locally.
  # Services are enabled individually only after isolated restore and cutover.
  homelab.updates.enable = true;
  # Roll out the transactional updater before assigning production services.
  homelab.updates.stateful.enable = true;
  homelab.runners = {
    enable = true;
    maxConcurrentJobs = 4;
    cpuBudget = 12;
    memoryBudgetMiB = 24576;
    tart.maxMacOSGuests = 2;
    linux = {
      enable = true;
      image = "ghcr.io/0x63616c/homelab-linux-runner@sha256:3c7defd1a13e63560c36523dbdbe25a3ef11e1f264390447c27d5c474e7ca6a2";
      routingAuditApproved = true;
      cpu = 2;
      memoryMiB = 4096;
      diskGrowthBytes = 25769803776;
    };
    admissionEnabled = true;
    githubAppId = "5662381";
    repositories."0x63616c/world-wide-webb" = {
      repositoryId = 1260632595;
      installationId = 179726287;
      runnerGroupId = 1;
      trustApproved = true;
    };
    # Xcode 27.2 candidate; promote only after the held-pool runtime canary.
    image = "ghcr.io/cirruslabs/macos-tahoe-xcode@sha256:f8315a2f627daf64ab2c4e11d29a4d267953902a16151ee28fcdd7185927c317";
    cpu = 4;
    memoryMiB = 8192;
    # Measured after caching the image: 171 GiB free on this test host.
    admissionFreeBytes = 150323855360; # 140 GiB
    emergencyFreeBytes = 85899345920; # 80 GiB
  };
  homelab.monitoring.agent = {
    enable = true;
    listenAddress = "100.96.15.83";
  };
}
