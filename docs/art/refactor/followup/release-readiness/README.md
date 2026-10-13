# Release readiness and original evidence

The failed `duels` check on PR #346 at `386e530de3a289e2f9e7aab5978f23e70a2953e2` reports 22 naming matches in this lane's documents and captured inputs. The current main at `46cb95ac3096d73bf60eff4eb651fb178efd3f83` has none. Earlier reports used an art-lane checkpoint as their comparison and called its 22 matches the baseline; that is historical context, not evidence that current main already has this failure.

This failure is a documentation and evidence-storage issue. It does not identify a gameplay or renderer defect. The test reads every file under `src` and `docs` as text and does not distinguish captured third-party/executed records from maintained specifications. Those captured bytes must remain intact. The current release check, its assertion, paths and original test SHA are unchanged.

Twenty completed captured inputs are stored at their original path plus `.gz`. Their original names, size, full SHA, Git source anchor and compressed identities are recorded in [captured-inputs.json](captured-inputs.json). The archive tool verifies all decoded bytes and restores the original paths; numeric results, executed helpers, old method wording and failed comparisons are not rewritten. Existing PNG/source manifests retain their original filenames and hashes. The PNG verifier can read the archived source bytes and checks the same original hashes.

Two maintained human reports use clearer current wording and link to the archives. Their exact pre-edit bytes are retained in [the report identity manifest](report-originals.json), [the card-streaming report archive](card-streaming-report-before-release.md.gz) and [the PNG report archive](png-archive-report-before-release.md.gz). Earlier test logs and observation manifests remain historical records; their failures do not become passes after this cleanup.

## Verify and restore

Run from the repository root:

```sh
python3 scripts/art-release-evidence-archive.py --verify --report /tmp/release-verify.json

# Restore the complete repo-relative paths into a new directory.
python3 scripts/art-release-evidence-archive.py --materialize \
  --out /tmp/new-release-evidence-tree --report /tmp/release-restore-proof.json

# Restore original paths before running historical comparison tools.
python3 scripts/art-release-evidence-archive.py --materialize --report /tmp/release-inplace.json

# Verify every original before returning to the archived checkout state.
python3 scripts/art-release-evidence-archive.py --verify --prune \
  --restore-proof /tmp/release-restore-proof.json --report /tmp/release-prune.json
```

Restoring original captured inputs in place temporarily exposes the old captured strings again. Finish the historical review and verify/prune those exact temporary copies before running the unchanged release check. Changed originals are never overwritten or removed. Frozen checkouts and source snapshots are not modified.

Output directories and operation reports must be new. Keep the independent temporary restoration and its proof until pruning finishes: pruning rechecks all restored bytes and all in-place originals before removing any original. The script records each operation separately and does not turn a historical failed test into a pass.

## Separate navigation failures

The three navigation test files were run once on a fresh detached current-main checkout at `46cb95a`: **82 tests passed and four failed**. Their names match the earlier observations, and the tested shared/SDK trees and configuration match this PR. See [the current-main result and identities](../../release-readiness/nav-main-46cb-result.json), [the original log](../../release-readiness/nav-main-46cb.log.gz) and [the Vitest report](../../release-readiness/nav-main-46cb-vitest.json).

Three assertions concern route/control shape; one requires every ship to fire within its observation window. The run establishes that these failures exist on current main, not that their requirements or implementation are correct. They require a separate navigation investigation and are not fixed by weakening assertions in this art/rendering PR.

## Remaining performance work

The native caller/helper/allocation/shared-memory/token-to-decoded-command chain remains unresolved, as described in [the native feasibility report](../card-streaming/stall-followup/native-causal-feasibility/README.md). Hardware GPU validation is also unfinished. Neither negative investigation produced a new production GPU candidate; rejected experiments remain outside production. These are explicit follow-up items, separate from fixing the release check.
