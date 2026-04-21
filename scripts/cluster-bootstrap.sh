#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-dev}"
CLUSTER_NAME="lw-idp-${PROFILE}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "${HERE}")"

# Safety: must be pointed at the right cluster
if [[ "$(kubectl config current-context)" != "kind-${CLUSTER_NAME}" ]]; then
  echo "error: kubectx is not kind-${CLUSTER_NAME} — run ./scripts/cluster-up.sh ${PROFILE} first" >&2
  exit 1
fi

cd "${ROOT}"

echo "==> helmfile sync (cert-manager, ingress, CNPG, NATS+nack, Dex, Dragonfly, observability)"
helmfile --file infra/helmfile.yaml sync

echo "==> seeding Dex dev secret (idempotent)"
kubectl create namespace dex --dry-run=client -o yaml | kubectl apply -f -
kubectl -n dex create secret generic dex-env \
  --from-literal=GITHUB_CLIENT_ID="${DEX_GITHUB_CLIENT_ID:-devnotreal}" \
  --from-literal=GITHUB_CLIENT_SECRET="${DEX_GITHUB_CLIENT_SECRET:-devnotreal}" \
  --from-literal=GATEWAY_CLIENT_SECRET="${DEX_GATEWAY_CLIENT_SECRET:-devnotreal}" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n dex rollout restart deploy/dex || true

echo "==> seeding per-service secrets (idempotent)"
kubectl create namespace lw-idp --dry-run=client -o yaml | kubectl apply -f -

# Wait up to 20s for pg-app Secret to exist
for i in $(seq 1 10); do
  if kubectl -n lwidp-data get secret pg-app >/dev/null 2>&1; then break; fi
  echo "  waiting for pg-app secret... (${i}/10)"
  sleep 2
done

PG_PW=$(kubectl -n lwidp-data get secret pg-app -o jsonpath='{.data.password}' | base64 -d)
if [[ -z "${PG_PW}" ]]; then
  echo "error: pg-app password empty" >&2
  exit 1
fi

for svc in identity catalog cluster; do
  dsn="postgres://postgres:${PG_PW}@pg-rw.lwidp-data.svc.cluster.local:5432/${svc}"
  kubectl -n lw-idp create secret generic "${svc}-svc-pg" \
    --from-literal=PG_DSN="${dsn}" \
    --dry-run=client -o yaml | kubectl apply -f -
done

# Dex client secret for identity-svc only (catalog/cluster don't need OIDC)
DEX_CLIENT_SECRET=$(kubectl -n dex get secret dex-env -o jsonpath='{.data.GATEWAY_CLIENT_SECRET}' | base64 -d)
kubectl -n lw-idp create secret generic identity-svc-dex \
  --from-literal=DEX_CLIENT_SECRET="${DEX_CLIENT_SECRET}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "==> applying Postgres Cluster CR"
kubectl apply -f infra/cnpg/cluster.yaml
kubectl -n lwidp-data wait --for=condition=Ready --timeout=300s cluster/pg

echo "==> applying per-service databases"
# Note: databases.postgresql.cnpg.io CRD is absent in this CNPG build (Path B).
# init-databases.sh idempotently creates each service DB via kubectl exec into
# the primary pod.  When the operator is upgraded to a version that ships the
# Database CR, replace this block with:
#   kubectl apply -f infra/cnpg/database-identity.yaml
bash "${ROOT}/infra/cnpg/init-databases.sh"

echo "==> applying NATS streams"
kubectl apply -f infra/nats/stream.yaml

echo "==> applying Dragonfly instance"
kubectl apply -f infra/dragonfly/instance.yaml
kubectl -n dragonfly-system wait --for=jsonpath='{.status.phase}'=ready --timeout=180s dragonfly/df

echo "==> waiting for observability pods"
kubectl -n observability wait --for=condition=Ready --timeout=300s pod -l app.kubernetes.io/name=prometheus || true
kubectl -n observability wait --for=condition=Available --timeout=300s deploy -l app.kubernetes.io/name=grafana || true
kubectl -n observability wait --for=condition=Ready --timeout=300s pod -l app.kubernetes.io/name=loki     || true
kubectl -n observability wait --for=condition=Ready --timeout=300s pod -l app.kubernetes.io/name=tempo    || true

echo "✓ bootstrap complete"
"${HERE}/cluster-doctor.sh" "${PROFILE}"
