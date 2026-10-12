# Frozen production regression

Production source corresponds to `7b8186e668398f7869e27e47eeba626f7af2b1ac`. The exact `src/` and `scripts/` bytes at suite start are recorded in [source-manifest.json](source-manifest.json), including the context-proof runner's output-directory change committed separately as `a09cb6c`. The manifest was rechecked after the suite: no source or test bytes changed during execution.

The final complete Vitest run collected **546 files / 5276 tests: 5270 passed, 6 failed** in 227.78 seconds. The original [JSON](full-suite.json) and [console log](full-suite.log) are retained. These six failures are exactly the already attributed four navigation assertions and two mercenary deadline assertions. No new art/rendering test failure remains; this is not a claim that the repository is fully green.

- [Navigation attribution](../../followup/navigation/README.md) reproduces identical failures on the original source and preserves the relevant navigation code/thresholds.
- [Mercenary attribution](../../followup/mercenary/README.md) distinguishes the pre-existing deadline failures from the trajectory change caused by the separately authorized priest price. No AI strategy or deadline was changed to pass the test.
- The earlier combined consumer run retained one erroneous new test expectation in [consumer-first.log](consumer-first.log). The test now observes the real drawn anchor, including hit shake. [Current implementation](canvas-body-facing.log) passes all 35 focused checks; the same case with the old facing behavior fails in the retained [negative control](canvas-body-facing-negative.log).

`npm run build:production` exited **0**, including global TypeScript checking, Vite and the server bundle; the [build log](build-production.log) retains the existing large-chunk warning. GPU-specific focused, strict-pixel, compaction and restoration evidence is in [card-memory](../../followup/card-memory/README.md). Final performance and browser gameplay checks use separate evidence and are not inferred from this test run.
