# lw-idp local dev orchestration.
# Real service watches land in Plan 1.2.

load('ext://helm_resource', 'helm_resource')

# Guard: require lw-idp-dev kubectx.
allow_k8s_contexts(['kind-lw-idp-dev'])

# Hosts file guidance.
print("""
Tilt is intentionally minimal in Plan 1.1 — no services exist yet.

Next steps:
  1. Ensure cluster is up:    ./scripts/cluster-up.sh dev
  2. Bootstrap infra:          ./scripts/cluster-bootstrap.sh dev
  3. (Plan 1.2+) Run `tilt up` to live-reload services.
""")
