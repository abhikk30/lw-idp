#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-dev}"
CLUSTER_NAME="lw-idp-${PROFILE}"
CONFIG="infra/kind/${PROFILE}.yaml"
REGISTRY_NAME="kind-registry"
REGISTRY_PORT=5001

if [[ ! -f "${CONFIG}" ]]; then
  echo "error: no cluster profile at ${CONFIG}" >&2
  exit 1
fi

# 1. Ensure Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "error: Docker is not running" >&2
  exit 1
fi

# 2. Ensure local image registry container is up (idempotent)
if ! docker inspect "${REGISTRY_NAME}" > /dev/null 2>&1; then
  echo "==> creating local registry on :${REGISTRY_PORT}"
  docker run -d --restart=always -p "127.0.0.1:${REGISTRY_PORT}:5000" \
    --network bridge --name "${REGISTRY_NAME}" registry:2
fi

# 3. Create cluster if missing
EXISTING_CLUSTERS="$(kind get clusters 2>/dev/null || true)"
if echo "${EXISTING_CLUSTERS}" | grep -qx "${CLUSTER_NAME}"; then
  echo "==> cluster ${CLUSTER_NAME} already exists"
else
  echo "==> creating cluster ${CLUSTER_NAME}"
  kind create cluster --config "${CONFIG}"
fi

# 4. Connect registry to kind network
if ! docker network inspect kind > /dev/null 2>&1; then
  echo "error: kind network not present" >&2
  exit 1
fi
if [[ -z "$(docker inspect -f '{{json .NetworkSettings.Networks.kind}}' "${REGISTRY_NAME}" 2>/dev/null || echo null)" || \
      "$(docker inspect -f '{{json .NetworkSettings.Networks.kind}}' "${REGISTRY_NAME}")" == "null" ]]; then
  docker network connect "kind" "${REGISTRY_NAME}" || true
fi

# 5. Document registry in cluster (standard kind pattern)
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: local-registry-hosting
  namespace: kube-public
data:
  localRegistryHosting.v1: |
    host: "localhost:${REGISTRY_PORT}"
    help: "https://kind.sigs.k8s.io/docs/user/local-registry/"
EOF

# 6. Set kubectx
kubectl config use-context "kind-${CLUSTER_NAME}"
kubectl cluster-info
echo "✓ cluster ${CLUSTER_NAME} is up"
