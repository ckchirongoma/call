#!/usr/bin/env bash
# Call — documents render with tables and inline hex only (SPEC R8).
# The quotation and the record of advice are HTML-email-grade: no grid, no
# flex, no CSS custom properties, no external stylesheet. These failed
# silently in some renderers in Charlie's first version and produced a
# colourless wall of text. The files below are the only document renderers.
set -euo pipefail
cd "$(dirname "$0")/.."
files="api/_lib/quotedoc.ts api/_lib/roa.ts api/_lib/docparts.ts"
existing=""
for f in $files; do [ -f "$f" ] && existing="$existing $f"; done
[ -z "$existing" ] && { echo "No document renderers yet"; exit 0; }
offenders="$(grep -nHE "display:\s*(grid|flex)|var\(--|<link[^>]+stylesheet|grid-template|flex-direction|margin:\s*-" $existing || true)"
if [ -n "$offenders" ]; then
  echo "Document renderer uses CSS that fails silently in some renderers (SPEC R8)." >&2
  echo "$offenders" >&2
  exit 1
fi
echo "Document renderers are table + inline-hex only"
