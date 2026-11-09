{ config, lib, ... }:
let
  # Determinate Nix uses GID 350 and build UIDs starting at 351.
  accounts = { _containers = 450; _runner = 451; }
    // lib.optionalAttrs config.homelab.monitoring.agent.enable { _monitor = 452; };
in {
  users.knownUsers = builtins.attrNames accounts;
  users.knownGroups = builtins.attrNames accounts;
  users.groups = lib.mapAttrs (name: id: { gid = id; members = [ name ]; }) accounts;
  users.users = lib.mapAttrs (name: id: {
    uid = id; gid = id; home = "/var/lib/${name}";
    createHome = true; isHidden = true; shell = "/usr/bin/false";
  }) accounts // {
    ${config.homelab.adminUser} = {
      uid = config.homelab.adminUID;
      home = "/Users/${config.homelab.adminUser}";
    };
  };
  # Only declared service accounts are managed; preserve existing accounts.
  system.activationScripts.preActivation.text = lib.mkAfter (
    lib.concatStringsSep "\n" (lib.mapAttrsToList (name: id: ''
      for entry in Users Groups; do
        field=UniqueID; [ "$entry" = Groups ] && field=PrimaryGroupID
        /usr/bin/dscl . -list /"$entry" "$field" | /usr/bin/awk '$2 == ${toString id} && $1 != "${name}" { bad=1 } END { exit bad }' || {
          echo '${name} numeric ID collision; refusing activation.' >&2; exit 1;
        }
        existing=$(/usr/bin/dscl . -read /"$entry"/${name} "$field" 2>/dev/null | /usr/bin/awk '{print $2}') || true
        if [ -n "$existing" ] && [ "$existing" != '${toString id}' ]; then
          echo '${name} existing ID mismatch; refusing activation.' >&2; exit 1
        fi
      done
      if /usr/sbin/dseditgroup -o checkmember -m ${name} admin 2>/dev/null | /usr/bin/grep -q '^yes'; then
        echo '${name} must not be an administrator.' >&2; exit 1
      fi
    '') accounts));
}
