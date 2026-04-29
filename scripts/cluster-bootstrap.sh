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

echo "==> patching CoreDNS for in-cluster *.lw-idp.local resolution (idempotent)"
# In-cluster pods (gateway-svc OIDC token exchange + JWKS, identity-svc verifier)
# need to reach Dex at the same hostname browsers use so the `iss` claim stays
# consistent. CoreDNS `rewrite` makes dex/portal/grafana .lw-idp.local resolve
# to the ingress controller's ClusterIP, which then routes to the right
# backing Service via the Ingress rules we already have.
#
# Idempotent: strips any prior marked block AND any unmarked rewrites for
# *.lw-idp.local (e.g. live-patched during debug) before inserting a fresh
# block above the kubernetes plugin so rewrites are evaluated first.
INGRESS_TARGET="ingress-nginx-controller.ingress-nginx.svc.cluster.local"
# Anchors must match the Corefile's 8-space indent (2 for YAML data + 6
# inside `.:53 {`) so they don't accidentally strip lines from the
# `last-applied-configuration` annotation, which embeds the prior Corefile
# as a single long JSON string and would otherwise corrupt the round-trip.
kubectl -n kube-system get cm coredns -o yaml \
  | sed -e '/^        # lw-idp-rewrite-begin$/,/^        # lw-idp-rewrite-end$/d' \
        -e '/^        rewrite name [a-zA-Z0-9.-]*\.lw-idp\.local /d' \
  | awk -v t="${INGRESS_TARGET}" '
      /^        kubernetes cluster.local/ && !done {
        print "        # lw-idp-rewrite-begin"
        print "        rewrite name dex.lw-idp.local " t
        print "        rewrite name portal.lw-idp.local " t
        print "        rewrite name grafana.lw-idp.local " t
        print "        rewrite name argocd.lw-idp.local " t
        print "        rewrite name jenkins.lw-idp.local " t
        print "        rewrite name sample.lw-idp.local " t
        print "        # lw-idp-rewrite-end"
        done=1
      }
      { print }
    ' \
  | kubectl apply -f -
kubectl -n kube-system rollout restart deploy/coredns
kubectl -n kube-system rollout status deploy/coredns --timeout=60s

echo "==> seeding Dex dev secret (idempotent)"
kubectl create namespace dex --dry-run=client -o yaml | kubectl apply -f -

# Precedence for each value:
#   1. DEX_*_CLIENT_{ID,SECRET} env var if set (explicit override)
#   2. existing Secret value if it's not the "devnotreal" placeholder
#      (preserves real GitHub OAuth creds across re-runs — see runbook)
#   3. "devnotreal" placeholder fallback
# Without rule 2, every re-run blows real creds back to placeholder, which
# would break login until the user re-applies them. Bit them once, fixing.
_existing() {
  kubectl -n dex get secret dex-env -o jsonpath="{.data.$1}" 2>/dev/null | base64 -d || true
}
_resolve() {  # _resolve <var-name> <env-var> <default>
  local existing
  existing=$(_existing "$1")
  if [[ -n "${!2:-}" ]]; then
    printf '%s' "${!2}"
  elif [[ -n "${existing}" && "${existing}" != "devnotreal"* ]]; then
    printf '%s' "${existing}"
  else
    printf '%s' "$3"
  fi
}

_PREV_GH_ID=$(_existing GITHUB_CLIENT_ID)
_PREV_GH_SECRET=$(_existing GITHUB_CLIENT_SECRET)
DEX_GH_ID=$(_resolve GITHUB_CLIENT_ID DEX_GITHUB_CLIENT_ID "devnotreal")
DEX_GH_SECRET=$(_resolve GITHUB_CLIENT_SECRET DEX_GITHUB_CLIENT_SECRET "devnotreal")

kubectl -n dex create secret generic dex-env \
  --from-literal=GITHUB_CLIENT_ID="${DEX_GH_ID}" \
  --from-literal=GITHUB_CLIENT_SECRET="${DEX_GH_SECRET}" \
  --from-literal=GATEWAY_CLIENT_SECRET="${DEX_GATEWAY_CLIENT_SECRET:-devnotreal}" \
  --from-literal=ARGOCD_CLIENT_SECRET="${DEX_ARGOCD_CLIENT_SECRET:-devnotreal-argocd}" \
  --from-literal=JENKINS_CLIENT_SECRET="${DEX_JENKINS_CLIENT_SECRET:-devnotreal-jenkins}" \
  --dry-run=client -o yaml | kubectl apply -f -

# Only roll Dex when the GitHub creds actually changed — repeated no-op
# bootstraps shouldn't log users out.
if [[ "${DEX_GH_ID}" != "${_PREV_GH_ID}" || "${DEX_GH_SECRET}" != "${_PREV_GH_SECRET}" ]]; then
  kubectl -n dex rollout restart deploy/dex || true
fi

echo "==> applying Postgres Cluster CR (must precede per-service secrets that depend on pg-app)"
kubectl apply -f infra/cnpg/cluster.yaml
kubectl -n lwidp-data wait --for=condition=Ready --timeout=300s cluster/pg

echo "==> seeding per-service secrets (idempotent)"
kubectl create namespace lw-idp --dry-run=client -o yaml | kubectl apply -f -

# Wait up to 20s for pg-app Secret to exist (CNPG creates it asynchronously
# after the Cluster CR's primary becomes Ready)
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

echo "==> syncing Postgres role password to match pg-app secret (idempotent)"
# CNPG normally keeps the `pg-app` Secret and the actual `postgres` role
# password in sync. A controller restart or helmfile re-sync can regenerate
# the Secret without rotating the role password, leaving every backend's
# PG_DSN stale → "password authentication failed" across all four services.
# Force-set the role password to whatever pg-app currently holds.
PG_PRIMARY=$(kubectl -n lwidp-data get pod \
  -l cnpg.io/cluster=pg,role=primary \
  -o jsonpath='{.items[0].metadata.name}')
kubectl -n lwidp-data exec "${PG_PRIMARY}" -c postgres -- \
  psql -U postgres -d postgres \
  -c "ALTER USER postgres WITH PASSWORD '${PG_PW}';"

for svc in identity catalog cluster notification; do
  dsn="postgres://postgres:${PG_PW}@pg-rw.lwidp-data.svc.cluster.local:5432/${svc}"
  kubectl -n lw-idp create secret generic "${svc}-svc-pg" \
    --from-literal=PG_DSN="${dsn}" \
    --dry-run=client -o yaml | kubectl apply -f -
done

# gateway-svc-dex (Dex client secret for OIDC code exchange)
DEX_CLIENT_SECRET=$(kubectl -n dex get secret dex-env -o jsonpath='{.data.GATEWAY_CLIENT_SECRET}' | base64 -d)
kubectl -n lw-idp create secret generic gateway-svc-dex \
  --from-literal=DEX_CLIENT_SECRET="${DEX_CLIENT_SECRET}" \
  --dry-run=client -o yaml | kubectl apply -f -

# argocd-dex (Dex client secret for Argo CD OIDC code exchange).
# Argo CD's chart values reference this via `$argocd-dex:clientSecret` — see
# infra/argocd/values.yaml configs.cm.oidc.config. The literal must match the
# `argocd` staticClient `secret:` in infra/dex/values.yaml.
ARGOCD_CLIENT_SECRET=$(kubectl -n dex get secret dex-env -o jsonpath='{.data.ARGOCD_CLIENT_SECRET}' | base64 -d)
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl -n argocd create secret generic argocd-dex \
  --from-literal=clientSecret="${ARGOCD_CLIENT_SECRET}" \
  --dry-run=client -o yaml | kubectl apply -f -
# Argo CD only reads secrets labeled `app.kubernetes.io/part-of: argocd`
# when resolving `$<secret>:<key>` refs in argocd-cm — without this label
# the OIDC client_secret silently resolves to empty and Dex returns
# "Invalid client credentials" on token exchange.
kubectl -n argocd label secret argocd-dex app.kubernetes.io/part-of=argocd --overwrite

# jenkins-dex (Dex client secret for Jenkins OIDC).
# The Jenkins controller mounts this Secret as the OIDC_CLIENT_SECRET env
# var via JCasC; see infra/jenkins/values.yaml `containerEnv`. The literal
# must match the `jenkins` staticClient `secret:` in infra/dex/values.yaml.
JENKINS_CLIENT_SECRET=$(kubectl -n dex get secret dex-env -o jsonpath='{.data.JENKINS_CLIENT_SECRET}' | base64 -d)
kubectl create namespace jenkins --dry-run=client -o yaml | kubectl apply -f -
kubectl -n jenkins create secret generic jenkins-dex \
  --from-literal=clientSecret="${JENKINS_CLIENT_SECRET}" \
  --dry-run=client -o yaml | kubectl apply -f -

# Jenkins service-account API token (P2.1.1.1).
# Both `jenkins-svc-token` (in jenkins ns) and `gateway-svc-jenkins-api`
# (in lw-idp ns) hold the SAME plaintext token. Jenkins's init.groovy
# (configured via JCasC in infra/jenkins/values.yaml) reads JENKINS_SVC_TOKEN
# at startup and seeds it as a fixed API token under user
# `lw-idp-gateway-svc` via ApiTokenStore.addFixedNewToken (which hashes
# internally). The gateway then Basic-auths to Jenkins's REST API as that
# user with the plaintext token.
#
# Idempotent: reuses an existing token if both Secrets already match.
# Generates a fresh random token only on first bootstrap of a cluster.
# `|| true` keeps `set -euo pipefail` from tripping on first-bootstrap when
# the Secret hasn't been created yet (kubectl exits 1 → pipefail propagates).
EXISTING_USERNAME=$(kubectl -n lw-idp get secret gateway-svc-jenkins-api \
  -o jsonpath='{.data.JENKINS_API_USERNAME}' 2>/dev/null | base64 -d || true)
EXISTING_TOKEN=$(kubectl -n lw-idp get secret gateway-svc-jenkins-api \
  -o jsonpath='{.data.JENKINS_API_TOKEN}' 2>/dev/null | base64 -d || true)
TOKEN_CHANGED=false
# Jenkins API token format: 2-char version prefix ("11") + 32 random hex chars
# = 34 total. ApiTokenStore.addFixedNewToken rejects anything else with
# IllegalArgumentException, so generate (and validate any reused value) in
# exactly that shape.
if [[ "${EXISTING_USERNAME}" == "lw-idp-gateway-svc" && ${#EXISTING_TOKEN} -eq 34 ]]; then
  SVC_TOKEN="${EXISTING_TOKEN}"
  echo "  jenkins svc token: reusing existing"
else
  SVC_TOKEN="11$(openssl rand -hex 16)"
  TOKEN_CHANGED=true
  echo "  jenkins svc token: generated new"
fi
kubectl -n jenkins create secret generic jenkins-svc-token \
  --from-literal=JENKINS_SVC_TOKEN="${SVC_TOKEN}" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n lw-idp create secret generic gateway-svc-jenkins-api \
  --from-literal=JENKINS_API_USERNAME="lw-idp-gateway-svc" \
  --from-literal=JENKINS_API_TOKEN="${SVC_TOKEN}" \
  --dry-run=client -o yaml | kubectl apply -f -
# When the token is freshly generated, restart Jenkins so init.groovy
# re-runs with the populated env, AND restart gateway-svc so it picks up
# the new token from its Secret. Skip on token reuse — pods already have
# the right value.
if [[ "${TOKEN_CHANGED}" == "true" ]]; then
  if kubectl -n jenkins get statefulset jenkins >/dev/null 2>&1; then
    kubectl -n jenkins rollout restart statefulset/jenkins || true
  fi
  if kubectl -n lw-idp get deploy gateway-svc >/dev/null 2>&1; then
    kubectl -n lw-idp rollout restart deploy/gateway-svc || true
  fi
fi

# gateway-svc-argocd-webhook + argocd-notifications-secret share the same
# bearer token. argocd-notifications signs outbound webhooks to the gateway
# with this token in the `X-Lw-Idp-Webhook-Token` header; the gateway
# constant-time-compares it. Spec §12.1 fallback A — bearer token instead
# of HMAC, since argocd-notifications has no first-class HMAC function.
WEBHOOK_TOKEN="${GATEWAY_ARGOCD_WEBHOOK_TOKEN:-devnotreal-webhook}"
# Key name matches the env var that charts/gateway-svc/values.yaml mounts
# (`ARGOCD_WEBHOOK_TOKEN`). The argocd-notifications-secret uses
# `webhook-token` (kebab-case) per Argo CD's templating conventions —
# they hold the same value but with different keys for each consumer.
kubectl -n lw-idp create secret generic gateway-svc-argocd-webhook \
  --from-literal=ARGOCD_WEBHOOK_TOKEN="${WEBHOOK_TOKEN}" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n argocd create secret generic argocd-notifications-secret \
  --from-literal=webhook-token="${WEBHOOK_TOKEN}" \
  --dry-run=client -o yaml | kubectl apply -f -

# gateway-svc-redis (Dragonfly connection string)
# Dragonfly service is in dragonfly-system namespace, no auth by default on dev profile
kubectl -n lw-idp create secret generic gateway-svc-redis \
  --from-literal=REDIS_URL="redis://df.dragonfly-system.svc.cluster.local:6379" \
  --dry-run=client -o yaml | kubectl apply -f -

# notification-svc-redis (Dragonfly connection — same as gateway-svc)
kubectl -n lw-idp create secret generic notification-svc-redis \
  --from-literal=REDIS_URL="redis://df.dragonfly-system.svc.cluster.local:6379" \
  --dry-run=client -o yaml | kubectl apply -f -

# notification-svc-nats (NATS JetStream)
kubectl -n lw-idp create secret generic notification-svc-nats \
  --from-literal=NATS_URL="nats://nats.nats-system.svc.cluster.local:4222" \
  --dry-run=client -o yaml | kubectl apply -f -

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

echo "==> applying Argo CD ApplicationSet for lw-idp services (idempotent)"
# Wait up to 60s for the ApplicationSet CRD to be available — the chart
# applies it during helmfile sync but the operator may take a few seconds
# to register it before a `kubectl apply -f` of the CR itself succeeds.
for i in $(seq 1 30); do
  if kubectl get crd applicationsets.argoproj.io >/dev/null 2>&1; then break; fi
  echo "  waiting for applicationsets CRD... (${i}/30)"
  sleep 2
done
kubectl apply -f infra/argocd/applicationset.yaml

echo "==> applying argocd-notifications config (idempotent)"
# Server-side apply patches the chart-managed argocd-notifications-cm without
# clobbering keys owned by the Helm release (e.g. context.argocdUrl).
# --force-conflicts lets us take ownership of keys we add here.
kubectl apply --server-side --force-conflicts -f infra/argocd/notifications.yaml
# Bounce the controller so it picks up the new templates and triggers immediately
# rather than waiting for its next full-resync interval.
kubectl -n argocd rollout restart deploy argocd-notifications-controller
kubectl -n argocd rollout status deploy argocd-notifications-controller --timeout=120s

echo "✓ bootstrap complete"
"${HERE}/cluster-doctor.sh" "${PROFILE}"
