#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-dev}"
CLUSTER_NAME="lw-idp-${PROFILE}"

fail=0

check() {
  local desc="$1"; shift
  if "$@" > /dev/null 2>&1; then
    echo "  ✓ ${desc}"
  else
    echo "  ✗ ${desc}"
    fail=1
  fi
}

echo "==> Cluster: ${CLUSTER_NAME}"
check "Docker daemon reachable"          docker info
check "kind cluster exists"              bash -c "kind get clusters 2>/dev/null | grep -qx ${CLUSTER_NAME}"
check "kubectx matches cluster"          bash -c "[[ \"\$(kubectl config current-context)\" == \"kind-${CLUSTER_NAME}\" ]]"
check "nodes Ready"                       bash -c "test \"\$(kubectl get nodes --no-headers | awk '{print \$2}' | grep -cv Ready)\" = 0"
check "CoreDNS Ready"                     bash -c "kubectl -n kube-system wait --for=condition=Ready pods -l k8s-app=kube-dns --timeout=5s"

echo ""
echo "==> Infra namespaces (if installed)"
for ns in cert-manager ingress-nginx cnpg-system nats-system dex dragonfly-system observability; do
  if kubectl get ns "${ns}" > /dev/null 2>&1; then
    unready=$(kubectl -n "${ns}" get pods --no-headers 2>/dev/null | awk '{print $3}' | grep -cvE '^(Running|Completed)$' || true)
    unready="${unready:-0}"
    if [[ "${unready}" == "0" ]]; then
      echo "  ✓ ${ns}"
    else
      echo "  ✗ ${ns} — ${unready} pod(s) not Running/Completed"
      fail=1
    fi
  fi
done

echo ""
if [[ "${fail}" == "0" ]]; then
  echo "✓ cluster healthy"
else
  echo "✗ issues found — see above"
  exit 1
fi
