{ revision, hosts }:
{
  schema = 1;
  inherit revision;
  hosts = builtins.mapAttrs (_: host:
    let
      cfg = host.config.homelab;
    in {
      inherit (cfg) activationReady adminUser adminUID;
      # The operator needs readiness, never the configured key material.
      hasAuthorizedKeys = cfg.authorizedKeys != []
        && builtins.all (key: builtins.match "[[:space:]]*" key == null) cfg.authorizedKeys;
      services = import ./assigned-services.nix cfg;
    }
  ) hosts;
}
