{ ... }: {
  networking.hostName = "homelab-macbook";
  # Owner reports M2 / 32 GB / approximately 500 GB / macOS 27.2. Check free space locally.
  # Services are enabled individually only after isolated restore and cutover.
  homelab.updates.enable = false;
  homelab.runners.enable = false;
}
