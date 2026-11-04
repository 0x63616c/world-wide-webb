{ ... }: {
  networking.hostName = "homelab-mac-mini";
  homelab.adminUser = "calum";
  # Fresh rebuild target. NEVER activate this over the existing production mini.
  homelab.activationReady = false;
  homelab.containers.enable = false;
  homelab.containers.services = [ ];
  homelab.updates.enable = false;
  homelab.runners.enable = false;
}
