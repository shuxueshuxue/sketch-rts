# 512-square dual-scratch native correctness

The original and standalone candidate both pass actual WebGL2 correctness on
frozen 8345: [original](original/proof.json), [candidate](candidate/proof.json),
[summary](summary.json), [original log](original.log), [candidate log](candidate.log).
Both browser processes exited. Each evidence set archives the exact full
providers, helper, historical preparation metadata, fixture and driver; all
run-start/final input hashes remain identical, with one complete-query public
Three module identity and matching texture constructor identity.

Candidate SHA is
`0263e5bfb530a48b5a25f3eb67dfeb6c113ed27e67d13643facb109bf7fb3ff4`.
Its metadata lists seven exact, unique before/after replacements; applying them
in order to original SHA3526789… reconstructs the entire candidate byte-for-byte.
The unchanged region helper remains SHA25d852a8…. This candidate contains no
row-band or 64 KiB chunk change and does not modify production.

Only authored 512x512 sources use two slots. Each slot has independent complete
RGBA storage, GPU texture, CPU-only DataTexture source and initialization/retry
state. Diff regions compare against the selected slot's own earlier image. A
complete successful layer transfer advances the cursor; failure retains the
selected invalid slot for full retry. Other sizes keep one slot. LRU continues
to allow at most five source-size groups, so at most six scratch textures when
512x512 is present. Releasing or evicting the group disposes both slots.

Each policy has 10,684 native mip/layer byte comparisons, all zero RGBA channel
differences. Every stored independent oracle/destination SHA is identical
across policies. The independent oracle uploads the full original RGBA domain
and GPU-generates the original complete native sRGB mip chain. Coverage includes
256/320/512/640/704 N0, N1/N2 tails for 256/512/640/704, transparent nonzero RGB,
old-pixel clears, narrow bands and full-height columns, compaction, dispose/
recreate, real context loss/restore704 and public-copy interruption/full retry
(including512 N1/N2). CPU sources remain uninitialized, caller bytes readonly,
and render targets restored. The fixture primes both slots before asking that
identical input skip scratch upload; equality with an unselected slot alone does
not imply the selected slot can skip.

| 512 scratch ownership | Original | Candidate | Added |
| --- | ---: | ---: | ---: |
| CPU complete RGBA bytes | 1,048,576 | 2,097,152 | 1,048,576 |
| GPU native mip bytes | 1,398,100 | 2,796,200 | 1,398,100 |
| Scratch textures | 1 | 2 | 1 |

These ownership values are checked against actual public stats in N0/N1/N2
fixtures; other sizes remain single-slot. Counts and regions for initial, full,
partial and unchanged uploads can differ due to the older per-slot histories.
Do not carry over row-band claims of equal ROI bytes/copy/generation counts.

The proof deliberately adds test-side GL instrumentation, fences and per-mip
raw framebuffer readback. It establishes correctness in this environment, not
wall-time benefit or portable hardware speed. Failures are injected after full
public copies, not within Three's internal UNPACK setup/restoration. The separate
135 color/depth/distance shader captures are not included. Full-frame timing
requires an independent owner-coordinated quiet window.

```sh
node scripts/art-card-upload-ring512-gpu-proof.mjs --source /tmp/sketch-stall-baseline-8345 --upload-policy original --require-skip --require-tail --out work/ring512-native-original/proof.json
node scripts/art-card-upload-ring512-gpu-proof.mjs --source /tmp/sketch-stall-baseline-8345 --upload-policy candidate --require-skip --require-tail --out work/ring512-native-candidate/proof.json
```

CLI `--original-source`, `--candidate-source`, `--region-source`, `--metadata`
accept archived evidence inputs in place of the default prepared `/tmp` files.
Output directories are exclusive so any negative results remain intact.
