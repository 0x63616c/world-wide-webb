#!/usr/bin/env bash
# Run from infra/ after configuring the home-server stack and image pins.
set -euo pipefail
stack="${1:?usage: deploy-www.sh <stack>}"

recover_legacy_worker() {
  local result=$?
  if [ "$result" -ne 0 ]; then
    local image
    image=$(kubectl -n control-center get deployment api -o 'jsonpath={.spec.template.spec.containers[0].image}') || image=''
    case "$image" in
      ghcr.io/0x63616c/www-control-center-www@*)
        echo 'Deploy failed after www activation; keeping legacy worker stopped to prevent duplicate enforcers.' >&2
        ;;
      '')
        echo 'Deploy failed; API image could not be checked. Legacy worker was not restarted.' >&2
        ;;
      *)
        echo 'Deploy failed before www activation; restoring the legacy worker.' >&2
        kubectl -n control-center scale deployment worker --replicas=1 || echo 'ERROR: legacy worker recovery failed.' >&2
        ;;
    esac
  fi
  exit "$result"
}
trap recover_legacy_worker EXIT

# The provider's dry-run retains the live default rollingUpdate field even when
# the desired spec has rollingUpdate:null. Clear it explicitly before preview.
# This changes no Pod template and does not restart the existing request-only API.
kubectl -n control-center patch deployment api --type=merge \
  -p '{"spec":{"strategy":{"type":"Recreate","rollingUpdate":null}}}'

# Reject invalid plans before interrupting the legacy enforcers.
pulumi preview --stack "$stack"
kubectl -n control-center scale deployment worker --replicas=0
kubectl -n control-center wait --for=delete pod -l app=worker --timeout=120s
pulumi up --yes --stack "$stack"
