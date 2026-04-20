#!/usr/bin/env bash
# Re-resolve every Helm chart's dependencies.
#
# Consumer service charts each bundle a copy of the lw-idp-service library chart
# as a pinned tarball in their charts/ subdir. The umbrella chart bundles each
# service chart. Whenever the library chart changes (or any consumer chart's
# Chart.yaml), every downstream tarball must be re-generated in lockstep —
# otherwise silent version skew can slip in.
#
# This script is idempotent. CI also runs it and fails if the working tree
# becomes dirty, catching any contributor who forgot to run it locally.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "${HERE}")"
cd "${ROOT}"

SERVICE_CHARTS=(gateway-svc identity-svc catalog-svc cluster-svc notification-svc web)

echo "==> updating service chart deps (lw-idp-service library)"
for chart in "${SERVICE_CHARTS[@]}"; do
  echo "   - charts/${chart}"
  helm dependency update "charts/${chart}" >/dev/null
done

echo "==> updating umbrella chart deps"
helm dependency update charts/lw-idp >/dev/null

echo "✓ all helm deps up to date"
