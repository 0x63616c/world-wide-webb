{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.homelab.monitoring.agent;
  package = import ../packages/beszel-agent.nix { inherit pkgs; };
  loggedAgent = pkgs.writeShellScript "homelab-beszel-agent" ''
    set -o pipefail
    ${package}/bin/beszel-agent 2>&1 | /usr/bin/logger -t homelab-beszel-agent
  '';
  # Accept only numeric addresses in Tailscale's IPv4 range. No wildcard, LAN
  # address, DNS re-resolution, or implicit port-only binding is possible.
  tailnetAddress = lib.types.addCheck lib.types.str (
    value:
    let
      parts = lib.splitString "." value;
      decimal = part: builtins.match "(0|[1-9][0-9]{0,2})" part != null;
    in
    builtins.length parts == 4
    && builtins.all decimal parts
    && builtins.elemAt parts 0 == "100"
    && lib.toInt (builtins.elemAt parts 1) >= 64
    && lib.toInt (builtins.elemAt parts 1) <= 127
    && builtins.all (part: lib.toInt part <= 255) parts
  );
  publicKey = lib.types.addCheck lib.types.str (
    value: builtins.match "ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [^\n\r]+)?" value != null
  );
in
{
  options.homelab.monitoring.agent = {
    enable = lib.mkEnableOption "the native Beszel host agent";
    publicKey = lib.mkOption {
      type = lib.types.nullOr publicKey;
      default = lib.removeSuffix "\n" (builtins.readFile ../lib/beszel-hub.pub);
      description = "Hub's public SSH key, committed after hub initialization. This is not a secret.";
    };
    listenAddress = lib.mkOption {
      type = lib.types.nullOr tailnetAddress;
      default = null;
      description = "This host's numeric Tailscale IPv4 address; port 45876 is fixed.";
      example = "100.100.100.100";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.publicKey != null;
        message = "Beszel agent requires the initialized hub's publicKey.";
      }
      {
        assertion = cfg.listenAddress != null;
        message = "Beszel agent requires this host's Tailscale listenAddress.";
      }
    ];
    environment.systemPackages = [ package ];
    system.activationScripts.users.text = lib.mkAfter ''
      /usr/bin/install -d -o _monitor -g _monitor -m 0700 /var/lib/_monitor
    '';
    launchd.daemons.homelab-beszel-agent = {
      # nix-darwin adds /bin/wait4path /nix/store before exec. Beszel's connection
      # manager retries a missing tailnet bind; launchd restarts process failures.
      # ASL/unified logging owns retention; pipefail preserves agent failures.
      command = lib.escapeShellArgs [ "${loggedAgent}" ];
      serviceConfig = {
        UserName = "_monitor";
        GroupName = "_monitor";
        WorkingDirectory = "/var/lib/_monitor";
        EnvironmentVariables = {
          HOME = "/var/lib/_monitor";
          PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
          DATA_DIR = "/var/lib/_monitor";
          KEY = if cfg.publicKey == null then "" else cfg.publicKey;
          LISTEN = "${if cfg.listenAddress == null then "" else cfg.listenAddress}:45876";
          CHECK_UPDATES = "false";
        };
        RunAtLoad = true;
        KeepAlive = true;
        ThrottleInterval = 30;
        ProcessType = "Background";
        Umask = 63;
        StandardOutPath = "/dev/null";
        StandardErrorPath = "/dev/null";
      };
    };
  };
}
