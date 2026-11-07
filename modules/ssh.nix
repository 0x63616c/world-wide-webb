{ config, lib, pkgs, ... }:
let
  helper = import ../packages/client.nix { inherit pkgs; };
  keys = pkgs.writeText "homelab-authorized-keys"
    (lib.concatStringsSep "\n" config.homelab.authorizedKeys + "\n");
in {
  options.homelab.authorizedKeys = lib.mkOption {
    type = lib.types.listOf lib.types.str; default = [ ];
    description = "Reviewed public keys for the existing human administrator.";
  };
  config = {
    services.openssh.enable = true;
    services.openssh.extraConfig = ''
      PubkeyAuthentication yes
      PasswordAuthentication no
      KbdInteractiveAuthentication no
      PermitRootLogin no
      AuthenticationMethods publickey
      AllowUsers ${config.homelab.adminUser}
      AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    '';
    # SSH rejects a key symlink whose resolved Nix-store parent is group-writable.
    system.activationScripts.etc.text = lib.mkAfter ''
      ${helper}/bin/homelab-host install-ssh-keys --user ${lib.escapeShellArg config.homelab.adminUser} --source ${keys}
    '';
  };
}
