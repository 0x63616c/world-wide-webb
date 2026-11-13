{ revision, hosts }:
{
  schema = 1;
  inherit revision;
  hosts = builtins.mapAttrs (
    _: host:
    let
      cfg = host.config.homelab;
    in
    {
      inherit (cfg) adminUser adminUID authorizedKeys;
      services = import ./assigned-services.nix cfg;
    }
  ) hosts;
}
