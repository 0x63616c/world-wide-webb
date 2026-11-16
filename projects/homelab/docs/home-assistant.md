# Home Assistant

Home Assistant Container runs in the independent `colima-ha` VM on the Mini,
with restored external Docker volume `ha_config` mounted at `/config`.
The LAN UI is <http://192.168.0.130:8123>. This is not HA OS; do not boot a
second copy of this production state.

## Memory and deployment

Desired sizing is 2 CPUs, **3 GiB VM RAM**, 12 GiB data disk and 8 GiB root disk.
`modules/homeassistant.nix` defines `memoryGiB`; the Mini explicitly sets 3 in
`hosts/homelab-mac-mini.nix`. `homelab.json` assigns the service, not its memory.
Compose limits HA to **2 GiB**, leaving 1 GiB inside the guest for Linux and Docker. The Mini's separate services VM remains
4 GiB, so combined guest allocations leave only 1 GiB nominally for macOS on
this 8 GiB host. Monitor host memory pressure after deployment; repository tests
do not establish adequate capacity under real load.

Normal deployment is checked main → `deploy/homelab` promotion → Comin's
stateful activation. Memory changes alter the generated HA Colima launcher and
its deployment-input hash. The planner selects HA, requires a verified off-host
backup, and includes Control Center in post-change health. Under the existing
operation lock, `stateful-activation.py` unloads the HA launcher, gracefully stops
the guest, unloads vmnet, activates the new generation, and ensures both launchers
are loaded. The launcher copies the new Colima profile before starting the stopped
guest with 3 GiB. No manual `colima set` or VM recreation is required. Bridge
readiness, external-volume checks, interrupted-transaction holds and LAN health
remain enforced. Allow a VM stop/start and a full HA container restart; no disks,
volume identities or HA integration entries are replaced.

`homelab-reconcile-ha` inspects the external `ha_config` volume, then runs
Compose `up --wait` under the same operation lock. Missing restored volume fails
closed; the daemon never creates or imports one.
