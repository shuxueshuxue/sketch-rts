# Correctness-stage integration (2026-10-11)

Production fixes through `0f93be6`, plus the survivor-body correction subsequently saved as `773ae59`, were exercised by the full run. The benchmark helper was added during this stage; its independent Node test API was accidentally collected by Vitest.

- Full raw run: **543 files, 5242 collected tests; 5235 passed, 7 failed, plus one empty-suite error**. See `full-suite.log` and `full-suite.json`. Duration 230.69 s. Original output is retained.
- One new test failure was the repository naming gate: three newly changed checksum/save files used a forbidden old-version variable name. Renamed those local variables only; the gate and checksum behavior are unchanged.
- The additional suite error came from `node:test` in a `.test.mjs` file collected by Vitest. Switched the test import to Vitest, preserving all assertions and timeout/error/disposal checks.
- **25 tests in four files pass** after these corrections (`integration-fixes.log`), including the repository boundary, checksum, story replay and GPU completion helper. Fix commit: `dd01b0f`.
- **Production build passes** (`build-production.log`): global TypeScript, Vite frontend and server bundle. Existing chunk-size warning remains; no deployment occurred.
- Survivor-body regression: **23/23** in `disembarked-body-tests.log`; final full run also included this source change.

The six remaining failed assertions are the same four navigation and two mercenary assertions documented in [navigation](../navigation/README.md) and [mercenary](../mercenary/README.md). Original names, deadlines and thresholds are preserved. Mercenary trajectories reflect the authorized rules-2 priest cost change; do not claim unchanged AI outcomes or a green full suite.

This record covers the correctness stage, before the next GPU upload optimization. That production change requires its own focused checks, strict GPU comparison, integration build and same-environment measurements.
