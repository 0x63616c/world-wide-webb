#!/bin/sh
set -eu
umask 077
IFS= read -r key
[ -n "$key" ]
[ ! -L "$HOME/.ssh" ]
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
file="$HOME/.ssh/authorized_keys"
[ ! -L "$file" ]
[ ! -e "$file" ] || [ -f "$file" ]
touch "$file"
chmod 600 "$file"
if ! grep -Fqx -- "$key" "$file"; then
    # Existing authorized_keys may lack its final newline; never join two keys.
    printf '\n%s\n' "$key" >> "$file"
fi
