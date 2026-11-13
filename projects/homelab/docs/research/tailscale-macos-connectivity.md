# Tailscale macOS connectivity investigation

Researched 2026-11-07 against upstream sources. Host observations below were supplied by the primary investigation; this research performed no host, account, or credential operations.

## Confirmed configuration fault

The host reported `openat ts.net: path escapes from parent`. Its `/etc/resolver/ts.net` was a Nix-managed symlink to `/etc/static/resolver/ts.net`. Tailscale 1.104.4's Darwin DNS configurator opens `/etc/resolver` with `os.OpenRoot`, then writes each match-domain file through `root.WriteFile`; write errors return immediately. Go's `os.Root` intentionally rejects paths that resolve outside its root. Together, these establish a direct explanation for the error: the generated resolver symlink escapes the directory that Tailscale permits itself to write. A regular file at that location avoids that specific conflict. [Pinned Darwin configurator](https://github.com/tailscale/tailscale/blob/v1.104.4/net/dns/manager_darwin.go#L74-L114), [Go Root contract](https://pkg.go.dev/os#Root).

The primary investigator replaced only this symlink with a regular resolver file, disabled its declarative management in Git, and restarted tailscaled. The DNS health error disappeared and a TCP connection to tailnet port 22 subsequently succeeded. This confirms removal of the DNS configuration fault. Because the daemon restart and filesystem correction happened together, it does **not** isolate which intervention restored TCP connectivity, or prove that this fault caused the earlier discovery failure.

## What the reconfiguration source establishes

Engine reconfiguration applies router settings before DNS. It records DNS health from the DNS setter's result; only successful DNS configuration invokes `reconfigureVPNIfNecessary`. The method returns joined router/DNS/VPN errors. Thus the DNS error makes the overall reconfiguration report failure and skips that conditional VPN callback; it does **not** mean that every preceding router or peer update was skipped. The callback's applicability to the OSS daemon would need separate confirmation before claiming that skipping it broke this host's data path. [Pinned engine reconfiguration](https://github.com/tailscale/tailscale/blob/v1.104.4/wgengine/userspace.go).

## Related reports and their limits

- Issue 11565 includes reverse-direction ping recovery and stale-relay observations. This resembles the initial recovery here, but this host's views both reported LAX; shared symptoms alone cannot establish the same cause. [Upstream issue](https://github.com/tailscale/tailscale/issues/11565).
- Issue 13461 concerns OSS macOS DNS setup and was closed with a maintainer statement that changes would ship in 1.102. A 1.104.4 host should not be diagnosed from the older version's missing-resolver behavior alone. Its concrete escaping symlink error is stronger evidence. [Upstream issue](https://github.com/tailscale/tailscale/issues/13461).
- Successful default `tailscale ping` does not establish a working application TCP path: the CLI documents that its default probes do not inject packets into either host's TUN interface. [Ping implementation and help](https://github.com/tailscale/tailscale/blob/v1.104.4/cmd/tailscale/cli/ping.go).

## Narrow next checks for the remaining SSH timeout

The latest observation is a successful TCP/22 connect followed by a 15-second silent `tailscale ssh admin@homelab-macbook /usr/bin/true` timeout. TCP reachability alone does not prove SSH negotiation, authentication, or command execution. Tailscale SSH intercepts tailnet port 22 when enabled, so LAN SSH and tailnet SSH can exercise different servers. [Official SSH documentation](https://tailscale.com/docs/features/tailscale-ssh).

1. Run the same wrapper with `TS_DEBUG_SSH_EXEC=1` and a bounded outer deadline. In 1.104.4 this logs the actual OpenSSH invocation and enables `-vvv`, identifying where progress stops.
2. Compare `/usr/bin/ssh -F /dev/null -vvv -o ConnectTimeout=8 admin@<tailnet-ip> /usr/bin/true`, retaining normal host-key verification. This isolates local SSH configuration and OS hostname resolution. For a noninteractive check, use the wrapper-generated verified host-key file with strict checking; do not disable host-key checks.
3. Compare verbose client progress with timestamp-matched server tailscaled logs. Distinguish waiting before TCP, before the SSH banner, during key exchange/authentication, and after session creation before making further changes.

The wrapper source matters here: on Darwin it does not install its own ProxyCommand, and with `CorpDNS=true` it can rewrite even a supplied peer IP into the peer's DNS name. Consequently, supplying an IP to `tailscale ssh` does not reliably bypass DNS, and inherited SSH configuration remains relevant. [Pinned SSH wrapper](https://github.com/tailscale/tailscale/blob/v1.104.4/cmd/tailscale/cli/ssh.go#L59-L144).

There is currently no evidence requiring broader ACLs, GUI login, a second daemon, or destructive resolver-directory cleanup.

## Follow-up: sleep is independently reproducible

The host power log showed repeated maintenance sleep/dark-wake cycles on AC despite idle sleep being disabled. A bounded root `caffeinate -s` assertion stopped those cycles during the image download and VM tests. After its one-hour expiry, the host resumed cycling; at 19:44 PST it had recorded 109 sleep/wake cycles since boot. Renewing the assertion restored `PreventSystemSleep=1`, and an encrypted Tailscale ping returned in 11 ms. LAN SSH also worked. This establishes a separate power-management cause of intermittent availability; it does not prove every earlier Tailscale failure had that cause.

The proposed Nix configuration declares a native AC-only keep-awake launch daemon. Long-duration closed-lid operation and startup before GUI login still require explicit validation. An idle/system sleep assertion should not be advertised as a general guarantee against every macOS lid-close sleep path. No Tailscale version or access policy was changed for this test.

## Follow-up: current macOS reports

Two recent upstream reports are relevant candidates, not established diagnoses:

- [Issue 22082](https://github.com/tailscale/tailscale/issues/22082) describes lost direct UDP connectivity after network changes. A later report in that thread attributes failed receive loops to socket errors involving a content filter and says an unstable build resolved that reporter's case. This host has not shown the matching receive-loop health warning; that report alone does not justify installing an unstable release.
- [Issue 21996](https://github.com/tailscale/tailscale/issues/21996) describes a Darwin route-listener `ENOBUFS` error closing the WireGuard engine while the application continues reporting Running. Its distinguishing logs include `Failed to read packet from TUN device` and `engine closing`.

The follow-up probe found no matching entries in the target's available unified logs for the preceding 20 minutes. This is limited evidence: the daemon has no explicit stdout/stderr log files configured, so absent unified-log entries do not exclude an error written only to stderr. Target health showed only the accept-routes advisory, while client health was empty.

A two-attempt encrypted TSMP probe timed out once and then received a response in 2.412 seconds; a subsequent tailnet TCP/22 connection succeeded. The client's peer status still reported Offline. These observations establish intermittent encrypted reachability and a disagreement with the peer's status field, not a durable recovery. LAN SSH remained usable throughout these follow-up checks. No version, ACL, or client security setting was changed during this follow-up.
