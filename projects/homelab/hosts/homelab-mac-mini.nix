{ pkgs, ... }: {
  networking.hostName = "homelab-mac-mini";
  # Production Mini: runs the services assigned in homelab.json.
  homelab.updates.enable = true;
  # Assigned services require the transactional updater and backups.
  homelab.updates.stateful.enable = true;
  # 8 GiB total: 4 GiB services + 3 GiB HA leaves 1 GiB for macOS; monitor pressure.
  homelab.containers.memoryGiB = 4;
  homelab.homeassistant.memoryGiB = 3;
  homelab.runners.enable = false;
  environment.systemPackages = [ (import ../packages/opentofu.nix { inherit pkgs; }) ];
  # Verified on the rebuilt Mini: en1 is the home-LAN default route.
  homelab.homeassistant.bridgeInterface = "en1";
  homelab.homeassistant.lanIPv4 = "192.168.0.130/24";
  homelab.homeassistant.lanIPv4Gateway = "192.168.0.1";
  homelab.containers.controlCenter.workersEnabled = true;
  homelab.containers.controlCenter.bedroomSwitchInput = "binary_sensor.shelly_bedroom_input_0";
  homelab.backups.enable = true;
  homelab.monitoring.agent = {
    enable = true;
    listenAddress = "100.73.156.11";
  };
}
