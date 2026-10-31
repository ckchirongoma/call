#!/usr/bin/env bash
# Call — no hardcoded model slugs under api/ (BEHAVIOR-MATRIX A10, SPEC R10).
# Ported from Charlie's CI. api/_lib/models.ts is the one exemption: the
# last-resort chain cannot live in the table it exists to survive the loss of.
set -euo pipefail
cd "$(dirname "$0")/.."
offenders="$(grep -rnoHE --include='*.ts' \
  "[\"'\`][a-z0-9][a-z0-9._-]*/([a-z0-9._-]*[0-9][a-z0-9._:-]*|[a-z0-9._-]+:free)[\"'\`]" \
  api/ 2>/dev/null | grep -v '^api/_lib/models\.ts:' || true)"
if [ -n "$offenders" ]; then
  echo "Hardcoded model slug under api/. Model choices belong in model_config." >&2
  echo "$offenders" >&2
  exit 1
fi
echo "No hardcoded model slugs under api/"
