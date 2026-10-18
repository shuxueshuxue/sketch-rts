#!/usr/bin/env bash
# Refuse files over the limit that a branch adds or changes. Raw evidence (archives, traces, videos, frame dumps) lives
# outside the repository; a PR keeps its summary and compact before/after images (see docs/EVIDENCE.md).
# Usage: scripts/check-file-sizes.sh <base-ref> [head-ref]
set -euo pipefail
base=${1:?base ref}
head=${2:-HEAD}
limit=$((1536 * 1024))
failed=0
while IFS= read -r -d '' path; do
  size=$(git cat-file -s "$head:$path")
  if (( size > limit )); then
    printf '%s is %d KB (limit %d KB)\n' "$path" $((size / 1024)) $((limit / 1024))
    failed=1
  fi
done < <(git diff -z --name-only --diff-filter=AM "$base...$head")
if (( failed )); then
  echo "Move these out of the repository (see docs/EVIDENCE.md) and commit a summary instead." >&2
  exit 1
fi
echo "No added or changed file over $((limit / 1024)) KB."
