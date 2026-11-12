#!/bin/bash
# Gather the entire Affilink workspace (excluding node_modules, data/affilink.db if large, and .git)
set -euo pipefail
ROOTDIR="$(cd "$(dirname "$0")" && pwd)"
OUTDIR="$ROOTDIR/.workspace_export"
rm -rf "$OUTDIR"
mkdir -p "$OUTDIR"

git_dir=$(git -C "$ROOTDIR" rev-parse --git-dir 2>/dev/null || true)

tar -czf "$OUTDIR/affilink-workspace.tar.gz" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.cache' \
  \
  -C "$ROOTDIR" . >/dev/null 2>&1 || {
    echo "[workspace] Failed to package workspace: check disk space or permissions" >&2
    exit 1
}
echo "[workspace] Created $OUTDIR/affilink-workspace.tar.gz"
