# Exact depth-one evidence storage and restoration

This guide describes the fixed [archive tool](../../../../../../../../scripts/art-depth1-evidence-archive.py). It does not claim an archive, prune or restoration has succeeded before its execution records exist. Native/gameplay and complete-frame results remain those of the [original experiment](../README.md); no capture, source or failed result is rewritten by packaging.

The initial packing attempt exited 1 because a member list used path-component ordering rather than the complete POSIX filename ordering required for verification. Only the first scope produced sidecars and manifests, and no original input was pruned. Its [preservation proof](packing-failure-v1/failure-preservation.json), [executed tool](packing-failure-v1/executed-archive.py.gz), [log](packing-failure-v1/run.log.gz), [first input manifest](packing-failure-v1/input-archives.json.gz) and [first source manifest](packing-failure-v1/source-archives.json.gz) retain complete original identities. The [ordering correction](packing-failure-v1/ordering-correction.json) records pre/post manifest SHA with every row's identity unchanged. Ordering repair changes archive enumeration, not the original capture bytes or diagnostic results.

The default operation covers nine fixed scopes: `native-original-v1`, `native-original-v2`, `native-candidate-v2`, `frame-abba/A1`, `frame-abba/B1`, `frame-abba/B2`, `frame-abba/A2`, `native-compare-v2` and `root`. The root scope owns root-level providers, logs, early checks and the frame comparison; it does not overlap run folders. Each scope stores `archives/input-archives.json` and `archives/source-archives.json`. The root pair is [inputs](input-archives.json) and [sources](source-archives.json). These are identities and original relative filenames, not replacement capture metadata.

Actual JSON, binary, HTTP/transformed JS, optimizer, provider, executed helper and log inputs are stored as adjacent `.gz` files. Every manifest records full original size/SHA and stored gzip size/SHA; verification independently decodes complete original bytes. The PNGs stay unchanged. Human Markdown stays readable and uncompressed; captured Markdown in `keptFiles` is also size/SHA protected, so finish its links before packaging and preserve that version afterward. This guide is in `archives/`, excluded from the captured member scopes, and can report later storage outcomes.

Original Git source bytes reuse the existing **1,125-file / 9,687,156-byte** source container, with file-set SHA `99aa634b5af359a3b85022df6b22f062955f5602c3d9567d723c0f3e637922a0`, stored size **2,221,603 bytes**, and gzip SHA `4367770df4b0e80693571cd930574bda73701e91a04bb8e9b779863637e26ec2`. Its [container](../../../../source-archives/99aa634b5af359a3b85022df6b22f062955f5602c3d9567d723c0f3e637922a0.tar.gz) is independently checked against Git `42bd61c74934dc76f30d42b62e1e31eb5c5974ff`. Only actually captured source paths are restored per scope; a missing or partial capture is not promoted to a full one. Candidate/provider bytes remain separate input members and are never inserted into the original Git source map.

From the repository root, verify already-created archives:

```sh
python3 scripts/art-depth1-evidence-archive.py --verify
```

Restore every original filename and source snapshot in place before running an original analyzer or helper that reads plain JSON or executed snapshots:

```sh
python3 scripts/art-depth1-evidence-archive.py --materialize
```

An independent restore requires a destination that does not exist. It preserves the full original repository-relative paths below that destination, copies unchanged PNG/Markdown and manifests, and includes the one pinned source container:

```sh
python3 scripts/art-depth1-evidence-archive.py --materialize --out /tmp/depth1-evidence-full-restore
```

For a single fixed scope, use `--folder native-candidate-v2` or another name from the list above. To rerun the strict native comparison, restore both successful native scopes and the comparison scope, then point `--original` and `--candidate` at the restored directories and use a fresh `--out`. Original JSON export filenames, sizes and hashes stay intact. The source snapshots are byte evidence only: they do not include the full `.git`, `public`, dependency installation or executable checkout.

Reproduction of new native captures additionally requires the earlier original [exact replay corpus](../../exact-upload-replay/README.md). The maintained depth-one driver accepts the existing `run-v1/capture.json.gz` and `proof.json.gz`, independently verifies complete decoded identities against the earlier manifest, and does not require dumping that corpus again. Restore the depth-one root provider inputs first; the [experiment commands](../README.md) explicitly select their `candidate.ts`, `original.ts`, `region.ts` and `source.json`. Prepare a clean frozen42bd checkout and the same captured dependencies/browser separately. Running an old executed driver requires its original inputs and helper bytes, not a newer maintained helper substituted into the past record.

`--archive` creates exclusive sidecars and manifests; it must not be repeated for an already archived scope. `--verify --prune` deletes only fully verified unchanged, untracked original members after complete preflight, leaving gzip, manifests, PNG and Markdown. It does not change Git index or production source. After an independent full-SHA restore has passed, only that operation's own temporary duplicate tree may be removed; archives remain. Actual commands, exits, counts, sizes, decoded SHA proof and cleanup belong in separate execution records.

## Completed execution

[Execution evidence](execution-evidence.json) records actual exit 0 for the repaired first-scope verification, remaining eight-scope creation, all-nine verification, full independent materialization, prune and final verification. [Executed v2 tool](executed-archive-v2.py.gz) and its [identity](executed-archive-v2-identity.json) preserve the successful tool's original bytes; the first failed tool and original manifests remain under `packing-failure-v1/`. The final verify report's `deletedOriginalFiles=0` describes that verification operation; [prune report](execution-v2prune.json.gz) describes the earlier deletion.

The nine scopes contain **799 original inputs / 99,253,356 bytes**, stored as **22,389,004 gzip bytes**. **50 unchanged PNG/Markdown files** stay readable. Seven actually captured complete source directories contain **7,875 files / 67,810,092 original bytes**, sharing the one pinned 2,221,603-byte container. Candidate/provider/runtime/helper identities stay separate. This storage reduction is lossless evidence packaging, not runtime memory or render performance.

[Independent full restoration](independent-full-restore-proof.json) verifies every input's complete original size/SHA, all kept files, every source SHA/Git blob, all manifest bytes and the common source container. After that proof, [temporary cleanup](temporary-restore-cleanup.json) removes only the operation's own **8,743-file / 204,094,392-byte** restored tree; archives remain. Original filenames can still be materialized using the commands above. Internal captured README bytes are now kept-SHA protected and are not edited after packaging.

The subsequent original SDK single test is separately documented in [the naming gate](../../../../naming-gate/README.md): actual **6 passed / 1 failed / 23.78 seconds**, the exact same original 22-path baseline and zero additional matches. [Validation](../../../../naming-gate/final-depth1-validation.json), [source/public freeze](../../../../naming-gate/final-depth1-source-freeze.json) and [complete log](../../../../naming-gate/final-depth1-single-test.log.gz) preserve that failure; neither packaging nor the wrapper's successful baseline comparison means all tests passed.
