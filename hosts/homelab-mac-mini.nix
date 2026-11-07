{ ... }: {
  networking.hostName = "homelab-mac-mini";
  # Fresh rebuild target. NEVER activate this over the existing production mini.
  homelab.updates.enable = true;
  homelab.runners.enable = false;
}
