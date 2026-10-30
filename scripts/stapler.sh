#!/bin/bash
set -euo pipefail

for attempt in 1 2 3; do
  if xcrun stapler "$@"; then
    exit 0
  else
    status=$?
  fi
  if [ "$status" -ne 68 ] || [ "$attempt" -eq 3 ]; then
    exit "$status"
  fi
  printf '::warning::stapler %s failed with CloudKit error 68 (attempt %s/3); retrying in 20 seconds.\n' "$1" "$attempt" >&2
  sleep 20
done
