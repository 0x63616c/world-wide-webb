# This test configuration must never activate on the physical VM host.
case "$(/usr/sbin/sysctl -n hw.model)" in
  VirtualMac*) ;;
  *) echo 'Refusing fixture activation outside a disposable VM.' >&2; exit 1 ;;
esac
test "$(/usr/bin/id -u admin)" = 501 || exit 1
