#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-dev}"

if [[ "${PROFILE}" == "all" ]]; then
  EXISTING_CLUSTERS="$(kind get clusters 2>/dev/null || true)"
  while IFS= read -r c; do
    if [[ "${c}" =~ ^lw-idp- ]]; then
      echo "==> deleting ${c}"
      kind delete cluster --name "${c}"
    fi
  done <<< "${EXISTING_CLUSTERS}"
  exit 0
fi

CLUSTER_NAME="lw-idp-${PROFILE}"

EXISTING_CLUSTERS="$(kind get clusters 2>/dev/null || true)"
if echo "${EXISTING_CLUSTERS}" | grep -qx "${CLUSTER_NAME}"; then
  echo "==> deleting cluster ${CLUSTER_NAME}"
  kind delete cluster --name "${CLUSTER_NAME}"
else
  echo "==> cluster ${CLUSTER_NAME} not present; nothing to do"
fi

echo "✓ down"
