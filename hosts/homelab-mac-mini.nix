{ ... }: {
  networking.hostName = "homelab-mac-mini";
  # Fresh rebuild target. NEVER activate this over the existing production mini.
  homelab.updates.enable = true;
  # Install the transactional updater while fresh enrollment has no services.
  homelab.updates.stateful.enable = true;
  # 8 GiB total: 4 GiB services + 2 GiB HA leaves 2 GiB for macOS.
  homelab.containers.memoryGiB = 4;
  homelab.homeassistant.memoryGiB = 2;
  homelab.runners.enable = false;
  # Verified on the rebuilt Mini: en1 is the home-LAN default route.
  homelab.homeassistant.bridgeInterface = "en1";
  homelab.homeassistant.lanIPv4 = "192.168.0.130/24";
  homelab.homeassistant.lanIPv4Gateway = "192.168.0.1";
  homelab.containers.controlCenter.workersEnabled = true;
  homelab.backups.enable = true;
}
