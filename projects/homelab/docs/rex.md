# Rex on the MacBook

The MacBook installs the official signed Rex server helper from a versioned preview
DMG and runs its server as `vov` through `org.nixos.homelab-rex`. launchd starts
it at boot without a graphical login. The Mini does not install or run Rex.

In Rex on your personal Mac, choose **Add Remote Host…** and enter
`ssh://vov@homelab-macbook.local` (use the MacBook's Tailscale name away from the
LAN). For the CLI, run `rex -S ssh://vov@homelab-macbook.local ls`.
SSH uses the existing approved key. There is no Rex TCP listener or additional
Tailscale enrollment. The socket is the private, default per-user
`/Users/coding/Library/Application Support/rex/server.sock`; state lives in
`/Users/coding/.local/state/rex`, and configuration in `/Users/coding/.config/rex`.
The host sets `REX_AUTOSTART=0` so SSH/CLI connections never compete with launchd.

Disconnecting your client leaves remote terminals running. Stopping/restarting the
server or rebooting the host interrupts running programs; saved session layouts
are not live-process recovery. Finish or stop agent tasks before updating Rex.
The signed server bundle is immutable in the Nix store: update its versioned URL
and hash in [the package](../packages/rex.nix) through a PR. Discover previews from the official
[appcast](https://blob.superlogical.com/public/rex-app/preview/appcast.xml); do not
pin the changing `latest.dmg` endpoint. Switch to upstream's official stable
release enclosure when available. Agent executables, provider authentication and
`rex skill setup` under `coding` are separate from this server installation.

Inspect the service with `sudo launchctl print system/org.nixos.homelab-rex`.
Server diagnostics go to `/var/log/homelab-rex/server.log` (private to `vov`).
An hourly logrotate job copies and truncates logs above 5 MiB, keeping two archives
without signalling or restarting Rex; the log can grow between hourly checks.

For protected folders such as Documents, grant the running server helper Full Disk
Access in macOS System Settings → Privacy & Security. The service launches the
signed executable directly: shell wrappers retain Bash's TCC responsibility even
after `exec`, so granting Rex alone would not cover its terminals. Do not grant
Bash access as a workaround. The grant is an OS permission, separate from Nix;
recheck it after a Rex package upgrade changes the executable's store path.
Restart Rex after granting access, then verify from a fresh Rex terminal with
`ls -A "$HOME/Documents" >/dev/null`. SSH success alone does not verify Rex access.
The package's install check exercises headless startup, a private socket,
client disconnect/reconnect and graceful shutdown in a temporary home. It never
loads launchd or changes the live host configuration. Boot/login behavior still
needs a live check after the reviewed deployment.
