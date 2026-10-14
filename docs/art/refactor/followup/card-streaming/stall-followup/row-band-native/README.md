# Row-band native GPU correctness

Both complete uploader providers passed actual WebGL2 correctness on frozen
`8345a0dcfeb96b6777ac3940ec64cba13816c851`: [original](original/proof.json),
[candidate](candidate/proof.json), [dual summary](summary.json),
[original log](original.log), [candidate log](candidate.log). Each proof archives
its exact original/candidate/helper/preparation metadata/runner/fixture bytes
in its `source-snapshot/` directory. Before/after source/tool/provider hashes
match, with one complete-query Three identity and constructor identity.

Each policy checks 1,850 hash-bearing native mip rows / 7,400 layer comparisons
against an independent full-domain GPU `DataArrayTexture.generateMipmap` oracle,
plus 124 compaction mip rows / 1,017 layer comparisons. All 8,417 layer
comparisons have zero changed RGBA channels. All stored oracle/destination hashes
match across the two policies. The compaction rows perform exact byte comparisons
but do not store individual hashes.

Coverage includes 256/320/512/640/704 source domains, native tails N1/N2 for
256/640/704, transparent nonzero RGB, clearing old pixels, identical source into
other destination layers, bottom-right single-pixel and seven-row band updates,
full-height columns, compaction depths 3/7/14, dispose/recreate, real context
loss/restore and new pages, and injected interruption after real public copies
with conservative full-scratch retry. Public renderer hooks verify that warm
CPU views share the full scratch buffer, preserve the full-width stride, use
the declared source/destination origins, and are never initialized as GPU
textures. Caller RGBA remains readonly.

Both policies have 210 warm CPU-view copies with exactly the same physical
rectangles and 156,098,648 total rectangle bytes in this fixture. The exposed
source-view byte sum changes from 264,241,152 to 175,323,904; this is the size of
the typed-array views, **not a measured reduction in physical upload bytes**.
The candidate still uses the original full GPU scratch domain, mip generation,
filtering, anisotropy and tail copies. No wall-time benefit is established.

Reproduce serially, from the repository root, with a clean detached 8345 worktree
and the archived standalone providers (defaults are the frozen `/tmp` originals):

```sh
node scripts/art-card-upload-row-band-gpu-proof.mjs --source /tmp/sketch-stall-baseline-8345 --upload-policy original --require-skip --require-tail --out work/row-band-native-original/proof.json
node scripts/art-card-upload-row-band-gpu-proof.mjs --source /tmp/sketch-stall-baseline-8345 --upload-policy candidate --require-skip --require-tail --out work/row-band-native-candidate/proof.json
```

Use `--original-source`, `--candidate-source`, `--region-source`, `--metadata`
with the archived inputs to avoid relying on `/tmp`. Output directories are
exclusive; failures and their input snapshots are retained. The correctness
fixture deliberately adds GL instrumentation, fences and raw framebuffer
readbacks and cannot be used as a performance benchmark. Failures are injected
after complete public copies, not inside Three's UNPACK setup/restoration.
This native transfer proof does not cover the separate 135 color/depth/distance
shader captures. Full-frame pilot and balanced ABBA are pending; production is
unchanged.
