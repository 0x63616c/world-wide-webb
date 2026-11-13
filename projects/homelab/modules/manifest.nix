{
  config,
  inputs,
  deploymentPolicy,
  reviewedHost,
  ...
}:
let
  services = reviewedHost.services;
  containers = builtins.filter (name: name != "home-assistant") services;
  actual = {
    inherit (config.homelab) adminUser adminUID authorizedKeys;
    services = import ../lib/assigned-services.nix config.homelab;
  };
in
{
  environment.etc."projects/homelab/revision.json".text = builtins.toJSON {
    repository = deploymentPolicy.repository;
    branch = deploymentPolicy.branch;
    host = config.networking.hostName;
    revision = inputs.self.rev or null;
  };
  homelab = {
    inherit (reviewedHost) adminUser adminUID authorizedKeys;
    containers.enable = containers != [ ];
    containers.services = containers;
    homeassistant.enable = builtins.elem "home-assistant" services;
  };
  # Approval uses this same manifest without requiring Nix on the operator Mac.
  assertions = [
    {
      assertion = actual == reviewedHost;
      message = "Evaluated host settings differ from the reviewed homelab.json manifest.";
    }
  ];
}
