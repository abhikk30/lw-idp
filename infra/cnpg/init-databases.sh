#!/usr/bin/env bash
# infra/cnpg/init-databases.sh
#
# Path B fallback: CNPG operator version in this cluster does NOT ship the
# databases.postgresql.cnpg.io CRD (only backups/clusters/imagecatalogs/
# poolers/scheduledbackups are registered).  We therefore create per-service
# databases directly on the primary via `kubectl exec`.
#
# Idempotent: uses "CREATE DATABASE ... IF NOT EXISTS" equivalent (DO block).
# Must be called AFTER `kubectl -n lwidp-data wait --for=condition=Ready
# --timeout=300s cluster/pg` in cluster-bootstrap.sh.

set -euo pipefail

NAMESPACE="${CNPG_NAMESPACE:-lwidp-data}"
CLUSTER="${CNPG_CLUSTER:-pg}"

# Resolve the current primary reported by the Cluster status.
PRIMARY="$(kubectl -n "${NAMESPACE}" get cluster "${CLUSTER}" \
  -o jsonpath='{.status.currentPrimary}')"

if [[ -z "${PRIMARY}" ]]; then
  echo "error: could not determine primary pod for cluster '${CLUSTER}' in namespace '${NAMESPACE}'" >&2
  exit 1
fi

echo "  primary pod: ${PRIMARY}"

# List of databases to ensure exist (owner always postgres).
DATABASES=(identity catalog cluster notification)

for DB in "${DATABASES[@]}"; do
  echo "  ensuring database: ${DB}"
  # CREATE DATABASE cannot run inside a PL/pgSQL DO block in PostgreSQL.
  # Instead: check pg_database at the shell level, create only if absent.
  EXISTS="$(kubectl -n "${NAMESPACE}" exec -c postgres "${PRIMARY}" -- \
    psql -U postgres -Atc "SELECT 1 FROM pg_database WHERE datname='${DB}'")"
  if [[ "${EXISTS}" == "1" ]]; then
    echo "    already exists — skipping"
  else
    kubectl -n "${NAMESPACE}" exec -c postgres "${PRIMARY}" -- \
      psql -U postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB} OWNER postgres;"
    echo "    created"
  fi
done

echo "  databases reconciled successfully"
