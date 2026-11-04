{ ... }: {
  networking.hostName = "homelab-macbook";
  homelab.adminUser = "admin";
  # Owner reports M2 / 32 GB / approximately 500 GB / macOS 27.2. Check free space locally.
  # Services are enabled individually only after isolated restore and cutover.
  homelab.activationReady = false;
  homelab.containers.enable = false;
  homelab.containers.services = [ ];
  homelab.updates.enable = false;
  homelab.runners.enable = false;
}
