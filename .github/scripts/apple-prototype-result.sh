#!/usr/bin/env bash
# A skipped matrix is green only when planning succeeded and selected no suites.
set -euo pipefail
[[ "$CHANGES_RESULT" == success ]] &&
{ [[ "$SUITES_RESULT" == success ]] ||
  { [[ "$SUITES" == '[]' ]] && [[ "$SUITES_RESULT" == skipped ]]; }; }
