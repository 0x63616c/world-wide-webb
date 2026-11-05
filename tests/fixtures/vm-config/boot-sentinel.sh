set -eu
# A successful boot marker also proves the guest decrypted its synthetic secret.
test "$(/bin/cat /run/secrets/vm-rehearsal-marker)" = synthetic-vm-only
umask 077
/usr/sbin/sysctl -n kern.boottime > /var/tmp/homelab-vm-e2e-boot
