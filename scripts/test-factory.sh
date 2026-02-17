#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLAWVAULT_BIN="${CLAWVAULT_BIN:-clawvault}"

if command -v "${CLAWVAULT_BIN}" >/dev/null 2>&1; then
  CLAWVAULT_VERSION="$("${CLAWVAULT_BIN}" --version)"
else
  CLAWVAULT_VERSION="$(node -e 'const fs=require("node:fs");const path=require("node:path");const pkg=JSON.parse(fs.readFileSync(path.join(process.argv[1],"package.json"),"utf8"));process.stdout.write(pkg.version || "unknown");' "${REPO_ROOT}")"
fi

echo "Hello, world!"
echo "Date: $(date)"
echo "ClawVault version: ${CLAWVAULT_VERSION}"
