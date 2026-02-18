#!/usr/bin/env bash
cd "$(dirname "$0")/.." || exit 1
git add -A
if git diff --cached --quiet; then
  echo "NO_CHANGES"
  exit 0
fi
COUNT=$(git diff --cached --numstat | wc -l | tr -d ' ')
git commit -m "auto-commit: vault sync $(date '+%Y-%m-%d %H:%M')" --quiet
HASH=$(git rev-parse --short HEAD)
echo "COMMITTED ${HASH} ${COUNT} files"
