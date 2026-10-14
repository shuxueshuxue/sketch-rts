#!/usr/bin/env bash
# Run only after the coordinator grants the exclusive formal performance window.
set -euo pipefail
task_source_root=${1:?Usage: bash scripts/art-card-bank-final-performance.sh SOURCE_ROOT [OUTPUT_ROOT]}
task_output_root=${2:-docs/art/refactor/followup/card-streaming/bank-order/final}
for task_scene in canonical mixed; do
  for task_role in reference candidate; do
    if [[ -e "$task_output_root/$task_scene-$task_role/raw.json" ]]; then
      printf 'Refusing to overwrite preserved raw evidence: %s\n' "$task_output_root/$task_scene-$task_role/raw.json" >&2
      exit 1
    fi
  done
done
for task_scene in canonical mixed; do
  if [[ "$task_scene" == canonical ]]; then
    task_hidden=0,9900
    task_cpu_frames=360
    task_real_frames=18
  else
    task_hidden=0
    task_cpu_frames=60
    task_real_frames=12
  fi
  for task_role in reference candidate; do
    task_mips=full
    if [[ "$task_role" == candidate ]]; then task_mips=native; fi
    printf 'FORMAL %s/%s: 1 bank, %s mips\n' "$task_scene" "$task_role" "$task_mips"
    node --import tsx scripts/art-card-bank-viewport-proof.mjs \
      --source "$task_source_root" --variant "final-$task_scene-$task_role" \
      --max-banks 1 --mips "$task_mips" --scene "$task_scene" --hidden "$task_hidden" \
      --repeats 2 --cpu-frames "$task_cpu_frames" --real-frames "$task_real_frames" \
      --paced --skip-simulation --out "$task_output_root/$task_scene-$task_role/raw.json"
  done
done
# Comparisons and raw aggregation begin only after every browser process exited.
for task_scene in canonical mixed; do
  node scripts/art-card-bank-compare.mjs --kind viewport \
    --before "$task_output_root/$task_scene-reference/raw.json" \
    --after "$task_output_root/$task_scene-candidate/raw.json" \
    --out "$task_output_root/$task_scene-comparison.json"
done
node scripts/art-card-bank-performance-summary.mjs --profile final \
  --root "$task_output_root" --out "$task_output_root/performance-summary.json"
