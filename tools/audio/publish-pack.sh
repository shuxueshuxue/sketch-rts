#!/usr/bin/env bash
# Publish a complete staged pack; validation must succeed before any upload.
set -euo pipefail
if [[ $# != 2 ]]; then
  echo 'Usage: tools/audio/publish-pack.sh <complete-pack-directory> <rsync-destination>' >&2
  exit 2
fi
staged=$(cd "$1" && pwd)
destination=$2
cd "$(dirname "$0")/../.."
node --import tsx tools/audio/validate-pack.ts "$staged"
# Assets arrive before either manifest can refer to them. Keep other files on
# the destination; a shared pack may contain older recordings still in use.
rsync -a --exclude=pack.json --exclude=extras.json -- "$staged/" "${destination%/}/"
# Only these two manifests participate in deletion: an omitted optional extras
# must not leave an older supplement active. Excluded recordings stay protected.
rsync -a --delay-updates --delete --include=pack.json --include=extras.json --exclude='*' -- "$staged/" "${destination%/}/"
