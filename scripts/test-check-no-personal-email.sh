#!/usr/bin/env bash
# Hermetic tests for check-no-personal-email.sh. Exercises the full
# extract→hash→block path WITHOUT ever referencing the real personal email:
# we inject a disposable address's digest via PERSONAL_EMAIL_SHA256_EXTRA and
# assert the guard blocks that address, passes on noreply/clean content, and
# never echoes a matched token. Exit 0 = all pass.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$HERE/check-no-personal-email.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

sha256_hex() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  else
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  fi
}

# Disposable test address , NOT the real one. Its digest is injected so the
# guard treats it as blocked for the duration of these tests only.
TEST_EMAIL="test.user@example.com"
TEST_DIGEST="$(sha256_hex "$TEST_EMAIL")"
export PERSONAL_EMAIL_SHA256_EXTRA="$TEST_DIGEST"

fails=0
pass() { printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n' "$1"; fails=$((fails + 1)); }

# 1. Blocks a file containing the (disposable) target email.
printf 'contact: %s\n' "$TEST_EMAIL" >"$TMP/bad.txt"
if bash "$GUARD" "$TMP/bad.txt" >"$TMP/out" 2>&1; then
  fail "should BLOCK a file containing the target email"
else
  pass "blocks a file containing the target email"
fi

# 2. The block output must NOT echo the matched email (redaction).
if grep -q "$TEST_EMAIL" "$TMP/out"; then
  fail "block output leaked the email token (must be redacted)"
else
  pass "block output redacts the matched token"
fi

# 3. Blocks case-insensitively (uppercased domain/local).
printf 'CONTACT: %s\n' "TEST.USER@EXAMPLE.COM" >"$TMP/upper.txt"
if bash "$GUARD" "$TMP/upper.txt" >/dev/null 2>&1; then
  fail "should BLOCK case-variant of the target email"
else
  pass "blocks case-insensitively"
fi

# 4. Blocks when the email is embedded mid-string.
printf 'mailto:%s?subject=hi\n' "$TEST_EMAIL" >"$TMP/embed.txt"
if bash "$GUARD" "$TMP/embed.txt" >/dev/null 2>&1; then
  fail "should BLOCK an embedded email"
else
  pass "blocks an embedded email"
fi

# 5. Passes on the GitHub noreply identity (the sanctioned commit address).
printf 'author: 6991398+0x63616c@users.noreply.github.com\n' >"$TMP/ok.txt"
if bash "$GUARD" "$TMP/ok.txt" >/dev/null 2>&1; then
  pass "passes on the noreply identity"
else
  fail "should PASS on the noreply identity"
fi

# 6. Passes on a clean file with no email at all.
printf 'just some code, no contact here\n' >"$TMP/clean.txt"
if bash "$GUARD" "$TMP/clean.txt" >/dev/null 2>&1; then
  pass "passes on a clean file"
else
  fail "should PASS on a clean file"
fi

# 7. The baked-in default digest is a well-formed 64-char hex (not mangled).
if grep -qE '"[0-9a-f]{64}"' "$GUARD"; then
  pass "baked default digest is well-formed 64-hex"
else
  fail "baked default digest is missing or malformed"
fi

if [ "$fails" -gt 0 ]; then
  printf '\n%d test(s) failed\n' "$fails" >&2
  exit 1
fi
printf '\nAll personal-email guard tests passed\n'
