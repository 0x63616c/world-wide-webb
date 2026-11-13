{
  config,
  lib,
  pkgs,
  ...
}:
let
  helper = import ../packages/client.nix { inherit pkgs; };
  users = config.homelab.sshUsers // {
    ${config.homelab.adminUser} = config.homelab.authorizedKeys;
  };
in
{
  options.homelab = {
    authorizedKeys = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Reviewed public keys for the existing human administrator.";
    };
    sshUsers = lib.mkOption {
      type = lib.types.attrsOf (lib.types.listOf lib.types.str);
      default = { };
      description = "Additional local accounts allowed key-only SSH access.";
    };
  };
  config = {
    services.openssh.enable = true;
    services.openssh.extraConfig = ''
      PubkeyAuthentication yes
      PasswordAuthentication no
      KbdInteractiveAuthentication no
      PermitRootLogin no
      AuthenticationMethods publickey
      AllowUsers ${lib.concatStringsSep " " (builtins.attrNames users)}
      AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    '';
    # SSH rejects a key symlink whose resolved Nix-store parent is group-writable.
    system.activationScripts.etc.text = lib.mkAfter (
      lib.concatStringsSep "\n" (
        lib.mapAttrsToList (
          name: authorizedKeys:
          let
            keys = pkgs.writeText "homelab-${name}-authorized-keys" (
              lib.concatStringsSep "\n" authorizedKeys + "\n"
            );
          in
          ''
            ${helper}/bin/homelab-host install-ssh-keys --user ${lib.escapeShellArg name} --source ${keys}
          ''
        ) users
      )
    );
  };
}
