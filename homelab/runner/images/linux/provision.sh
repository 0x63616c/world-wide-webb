#!/usr/bin/env bash
# Trusted image provisioning only. Never run on a production host.
set -euo pipefail
[ "$(uname -m)" = aarch64 ]
[ "$(id -u)" = 1000 ]
[ "$HOME" = /home/admin ]
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  ca-certificates curl git build-essential pkg-config libssl-dev \
  libicu74 libkrb5-3 zlib1g libunwind8 docker.io python3 python3-venv python3-yaml jq patch
sudo usermod -aG docker admin
# The image's RPC service runs as admin; new sessions pick up the Docker group.
bash /home/admin/runner-source/images/linux/provision-guest-agent.sh
sudo install -m 0644 /home/admin/runner-source/images/linux/tart-guest-agent.service /etc/systemd/system/tart-guest-agent.service
# Pin the toolchain; Cargo.lock pins dependencies. The resulting ELF helper
# lives in the image, never in a Darwin Nix closure.
curl -fL --retry 3 https://static.rust-lang.org/rustup/archive/1.28.2/aarch64-unknown-linux-gnu/rustup-init -o /tmp/rustup-init
curl -fL --retry 3 https://static.rust-lang.org/rustup/archive/1.28.2/aarch64-unknown-linux-gnu/rustup-init.sha256 -o /tmp/rustup-init.sha256
(cd /tmp && sha256sum --check rustup-init.sha256)
chmod 0700 /tmp/rustup-init
/tmp/rustup-init -y --profile minimal --default-toolchain 1.99.1 --component rustfmt --component clippy
source "$HOME/.cargo/env"
cargo build --manifest-path /home/admin/runner-source/Cargo.toml --locked --release --bin homelab-runner-guest
sudo install -d -m 0755 /usr/local/libexec
sudo install -m 0555 /home/admin/runner-source/target/release/homelab-runner-guest /usr/local/libexec/homelab-runner-guest
# Explicit public DNS is required because production Softnet blocks gateway DNS.
sudo mkdir -p /etc/systemd/resolved.conf.d
printf '[Resolve]\nDNS=1.1.1.1 9.9.9.9\nFallbackDNS=\nDomains=~.\n' | sudo tee /etc/systemd/resolved.conf.d/homelab-public.conf >/dev/null
# Ubuntu cloud images use netplan; disable DHCP-provided DNS on the VM interface.
sudo python3 - <<'PY'
import glob
import yaml
for name in glob.glob('/etc/netplan/*.yaml'):
    with open(name) as f:
        config=yaml.safe_load(f)
    for interface in config.get('network',{}).get('ethernets',{}).values():
        if interface.get('dhcp4'):
            interface['dhcp4-overrides']={'use-dns':False}
            interface['nameservers']={'addresses':['1.1.1.1','9.9.9.9']}
    with open(name,'w') as f:
        yaml.safe_dump(config,f)
PY
sudo systemctl enable tart-guest-agent.service docker.service systemd-resolved.service
# No runner/helper service is enabled in the base image. Preparation owns the
# first one-shot claim. Disable network login after trusted provisioning.
sudo install -d -o admin -g admin -m 0700 /var/lib/homelab-runner
sudo install -d -m 0755 /usr/local/share/homelab
sudo sh -c 'dpkg-query -W > /usr/local/share/homelab/image-packages.txt'
sudo install -m 0444 /home/admin/runner-source/Cargo.lock /usr/local/share/homelab/runner-Cargo.lock
# Keep the pinned toolchain and public crate download cache for native CI jobs;
# remove the helper build/source tree and retain no job registration.
sudo rm -rf /home/admin/runner-source
sudo rm -f /home/admin/.ssh/authorized_keys
sudo systemctl disable ssh.service ssh.socket || true
rm -rf /tmp/tart-agent /tmp/tart-agent.tar.gz /tmp/rustup-init /tmp/rustup-init.sha256
sudo apt-get clean
