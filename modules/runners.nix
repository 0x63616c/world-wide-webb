{ config, lib, ... }: {
  options.homelab.runners = {
    enable = lib.mkEnableOption "isolated ephemeral VM runner controller";
    maxConcurrentJobs = lib.mkOption { type = lib.types.ints.positive; default = 1; };
    tart.maxMacOSGuests = lib.mkOption { type = lib.types.ints.positive; default = 2; };
  };
  config.assertions = [
    { assertion = config.homelab.runners.maxConcurrentJobs == 1;
      message = "The approved fleet-wide concurrency is one job."; }
    { assertion = config.homelab.runners.tart.maxMacOSGuests <= 2;
      message = "At most two macOS guests per host."; }
    { assertion = !config.homelab.runners.enable;
      message = "Runner controller is not yet validated: do not run jobs on the host as a fallback."; }
  ];
}
