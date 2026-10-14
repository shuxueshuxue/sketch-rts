# Current mask/peak/cache correctness recheck — prepared, not run

The frozen visual oracles both use source `0de509cc01e47b91a3012d33d2e75a7106d3e4a5`:

- Camera: `docs/art/refactor/followup/card-streaming/bank-order/final/camera-candidate/proof.json`; one bank, native mips, 31 views, 62 PNGs, 5,210 actual production picking probes. Includes DPR 1/2, six zooms, two viewport sizes, empty/return and first promotion captures.
- Real mercenary gameplay: `docs/art/refactor/followup/mercenary-models/gameplay-final/proof.json`; 40 full 1440×1000 frames, nine portrait/body/ordinary images, nine actual picks, 44 directional action/carry samples, three observed deaths, real hire/attack/heal facts.

The corresponding original PNG byte sets are preserved by each folder's `png-archive.json`. Do not change those proofs or their older comparisons. The older bank camera comparator requires identical client source and would correctly reject a cross-revision comparison. Use the new independent `scripts/art-card-current-correctness-compare.mjs` instead; it permits only the explicitly named four optimization module names and their test files (`card-pick-mask`, `painted-card-batches`, `card-raster-cache`, `card-mip-uploader`) to differ, and records every actual source difference.

## Captures after the coordinator releases the browser window

Use the final frozen current source for both commands; replace the source path only if the coordinator provides a separate frozen worktree. The example paths below must not exist before capture because the frozen capture harnesses themselves do not refuse overwrites. Run serially, outside any performance window.

```sh
node --import tsx scripts/art-card-bank-camera-proof.mjs \
  --source /workspace/sketch-rts-viewport \
  --variant final-one-bank-native-candidate --max-banks 1 --mips native \
  --out work/art-current-correctness/camera/proof.json

node --import tsx scripts/art-mercenary-gameplay-proof.mjs \
  --source /workspace/sketch-rts-viewport \
  --out work/art-current-correctness/merc/proof.json
```

These are the existing capture harnesses with no added observations or policy overrides. The mercenary harness also writes its existing viewing video using FFmpeg after capture; this is correctness work, not a timed performance sample.

## Exact archive recovery and comparison

The temporary destinations must not exist. Recovery checks archive/source/PNG hashes and leaves the archived evidence folders unchanged.

```sh
python scripts/art-png-evidence-archive.py --materialize \
  --folder card-streaming/bank-order/final/camera-candidate \
  --out /tmp/art-current-oracle-camera-0de
python scripts/art-png-evidence-archive.py --materialize \
  --folder mercenary-models/gameplay-final \
  --out /tmp/art-current-oracle-merc-0de

node scripts/art-card-current-correctness-compare.mjs --kind camera \
  --before docs/art/refactor/followup/card-streaming/bank-order/final/camera-candidate/proof.json \
  --after work/art-current-correctness/camera/proof.json \
  --oracle-png-root /tmp/art-current-oracle-camera-0de \
  --out work/art-current-correctness/camera-comparison.json

# Set this to the full authorized upstream AI commit supplied by the coordinator.
# It is required when old/new captured AI trees differ; abbreviated SHAs fail.
node scripts/art-card-current-correctness-compare.mjs --kind merc \
  --upstream-ai-source "$task_upstream_ai_commit" \
  --before docs/art/refactor/followup/mercenary-models/gameplay-final/proof.json \
  --after work/art-current-correctness/merc/proof.json \
  --oracle-png-root /tmp/art-current-oracle-merc-0de \
  --out work/art-current-correctness/merc-comparison.json
```

The comparison directly decodes all RGB/RGBA PNG channels without a Canvas round trip, requires zero pixel differences, and freshly verifies original encoded PNG hashes. It also requires the frozen harness/fixture identity, authoritative facts/clocks, actual pick arrays, camera native drawing-buffer and composite hashes, and real gameplay releases/commands/deaths to match. Mercenary shared/server trees must be equal, and both proofs must record an empty rules diff. Every captured rule-tree SHA is checked against its captured Git commit. If the AI tree changed through the authorized upstream integration, `--upstream-ai-source` must explicitly name its full commit SHA: the new captured AI tree must exactly equal that upstream tree, and that upstream commit must be an ancestor of the after capture. This is not a general AI exclusion; all raw simulation hashes, releases, commands and outcomes still must match. Unchanged art/client files are checked; `card-upload-region.ts` and art files are not part of the four-module allowlist. Counter/CPU ownership values are not asserted equal merely because pixels match.

The camera fixture samples three screen offsets per actor (`[0,0]`, `[6,-8]`, `[-10,0]`), and the mercenary fixture samples nine actual actor picks. These are real production picking checks, not an exhaustive transparent-UV boundary suite. The independent mask semantics corpus covers threshold, UV and packing edge cases. Do not claim the camera run covers every transparent mask coordinate.

No browser, test, image decode or archive extraction has been run for this prepared plan. The new comparator has only received a Node syntax check; image/fact comparison remains unexecuted pending review/window assignment. Any extra production source changes outside its explicit allowlist are a reported failure requiring review, not silently ignored.
