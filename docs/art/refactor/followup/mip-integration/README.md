# e06e047 integration validation

Production source was frozen at `e06e047724825905815f30c79253bff72567f37d` for this run, including the UI portrait ownership changes and dirty-layer mip generation/context recovery.

- Full Vitest run: 545 files, 5261 tests; 5254 passed, 7 failed. Original JSON and text output are retained alongside this note.
- Six failures are the four navigation and two mercenary assertions already reproduced and attributed in the neighboring `navigation/` and `mercenary/` evidence. No thresholds, AI routes or ship behavior were changed to suppress them.
- The seventh failure is the repository-wide naming gate finding wording in five newly archived benchmark evidence files. This was a documentation/archive integration error. Original raw bytes are now preserved in compressed archives, with a semantically identical readable JSON representation and explicit hashes; the test itself is unchanged. The [targeted rerun](../performance/formal-completion/naming-check.log) passed all seven package/naming checks, and [archive auditing](../performance/formal-completion/archive-audit.json) verified the original bytes and parsed JSON semantics.
- `npm run build:production` exited 0, including global TypeScript checking, Vite and the server bundle. Existing large-chunk warnings remain in the raw log.

This stage does not validate the subsequent CPU backing-memory change. That change requires its own regression, visual parity, resource lifecycle and same-environment performance results.
