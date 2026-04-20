#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-dev}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> cluster-reset ${PROFILE}"
"${HERE}/cluster-down.sh"      "${PROFILE}"
"${HERE}/cluster-up.sh"        "${PROFILE}"
"${HERE}/cluster-bootstrap.sh" "${PROFILE}"

echo "✓ cluster ${PROFILE} reset complete"
