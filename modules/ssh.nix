{ config, lib, ... }: {
  options.homelab.authorizedKeys = lib.mkOption {
    type = lib.types.listOf lib.types.str; default = [ ];
    description = "Reviewed public keys for the existing human administrator.";
  };
  config = {
    assertions = [{
      assertion = !config.homelab.activationReady || config.homelab.authorizedKeys != [ ];
      message = "Supply a verified administrator SSH public key before enabling activation.";
    }];
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
    environment.etc."ssh/authorized_keys/${config.homelab.adminUser}".text =
      lib.concatStringsSep "\n" config.homelab.authorizedKeys + "\n";
  };
}
