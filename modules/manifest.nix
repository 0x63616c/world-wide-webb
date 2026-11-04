{ config, reviewedHost, ... }:
let
  services = reviewedHost.services;
  containers = builtins.filter (name: name != "home-assistant") services;
  actual = {
    inherit (config.homelab) adminUser adminUID authorizedKeys activationReady;
    services = import ../lib/assigned-services.nix config.homelab;
  };
in {
  homelab = {
    inherit (reviewedHost) adminUser adminUID authorizedKeys activationReady;
    containers.enable = containers != [];
    containers.services = containers;
    homeassistant.enable = builtins.elem "home-assistant" services;
  };
  # Approval uses this same manifest without requiring Nix on the operator Mac.
  assertions = [{
    assertion = actual == reviewedHost;
    message = "Evaluated host settings differ from the reviewed homelab.json manifest.";
  }];
}
