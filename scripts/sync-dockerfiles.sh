#!/usr/bin/env bash
# Keep backend Dockerfiles byte-identical to apps/_shared/Dockerfile.backend.
#
# Usage:
#   ./scripts/sync-dockerfiles.sh --check   # exit non-zero if any target drifts
#   ./scripts/sync-dockerfiles.sh --write   # copy template into each target
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "${HERE}")"
TEMPLATE="${ROOT}/apps/_shared/Dockerfile.backend"

# Services that consume the shared Dockerfile. Add new entries here as services adopt the pattern.
TARGETS=(
  "apps/identity-svc/Dockerfile"
  "apps/catalog-svc/Dockerfile"
  "apps/cluster-svc/Dockerfile"
  "apps/gateway-svc/Dockerfile"
)

mode="${1:-}"
if [[ "${mode}" != "--check" && "${mode}" != "--write" ]]; then
  echo "usage: $0 --check | --write" >&2
  exit 2
fi

if [[ ! -f "${TEMPLATE}" ]]; then
  echo "error: template missing at ${TEMPLATE}" >&2
  exit 1
fi

fail=0
for rel in "${TARGETS[@]}"; do
  abs="${ROOT}/${rel}"
  if [[ "${mode}" == "--check" ]]; then
    if [[ ! -f "${abs}" ]]; then
      echo "✗ missing: ${rel}"
      fail=1
      continue
    fi
    if cmp -s "${TEMPLATE}" "${abs}"; then
      echo "  ✓ ${rel}"
    else
      echo "  ✗ drift: ${rel}"
      echo "    diff: diff ${TEMPLATE} ${abs}"
      fail=1
    fi
  else
    mkdir -p "$(dirname "${abs}")"
    cp "${TEMPLATE}" "${abs}"
    echo "  → wrote ${rel}"
  fi
done

if [[ "${mode}" == "--check" && "${fail}" != "0" ]]; then
  echo "FAIL: one or more Dockerfiles drifted from ${TEMPLATE}"
  echo "Fix with: ./scripts/sync-dockerfiles.sh --write"
  exit 1
fi

echo "✓ Dockerfiles in sync"
