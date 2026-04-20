#!/usr/bin/env bash
set -euo pipefail

read -p "⚠  This will delete all lw-idp kind clusters, the local registry, and cached images. Continue? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "aborted"
  exit 0
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${HERE}/cluster-down.sh" all

if docker inspect kind-registry > /dev/null 2>&1; then
  echo "==> removing local registry"
  docker rm -f kind-registry
fi

echo "==> pruning dangling images + build cache"
docker image prune -a -f
docker builder prune -a -f || true

echo "✓ nuked"
