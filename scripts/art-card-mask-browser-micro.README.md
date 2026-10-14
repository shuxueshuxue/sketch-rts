# Original RGBA pick-mask CPU micro (ready, not run)

The CDP tool uses the exact four-way `/tmp/card-mask-prototype` common module:
reference, byte-alpha-zero skip, unsigned LE words, words plus zero-block skip.
It imports no game modules and creates no Canvas, WebGL or WebGPU work. Chromium
launch disables GPU/WebGL, and every Canvas/OffscreenCanvas getContext request
throws. This is a CPU algorithm diagnostic, not a renderer frame benchmark.

Start only after the coordinator grants an exclusive quiet window:

```sh
node scripts/art-card-mask-browser-micro.mjs \
  --corpus docs/art/refactor/followup/card-streaming/latency-investigation/canvas-attribution/corpus-manifest.json \
  --prototype /tmp/card-mask-prototype/pack-mask-prototype.mjs \
  --out docs/art/refactor/followup/card-streaming/latency-investigation/mask-micro/result.json \
  --engine both --rounds 8 --repeats 3
```

The tool refuses to overwrite result/source snapshots. `--expected-browser`
defaults to the actual prior identity `Chrome/151.0.7922.173`, which is checked
against Browser.getVersion; V8/version/user agent are recorded, not invented.
`--source` must contain the mask reference source matching the corpus's published
source SHA. `--engine node` or `browser` isolates one engine when desired.
Use a fresh output directory: a failed snapshot write may leave partial source
files; retry into a new directory rather than deleting or overwriting evidence.

The source corpus consists of 36 original production Canvas-miss getImageData
samples captured at n116/n135/n158, before row flipping, with full512/704 domains
and transparent RGB. The micro runner never paints them. It verifies byte length
and SHA on the host, then the frontend independently fetches and SHA-checks the
manifest, source helpers and every complete bin. It rechecks full source SHA
after timing. Original corpus/source/proof files are not modified. Copies of the
driver, browser fixture, shared matrix and prototype are saved with actual SHA.
The copied manifest retains its original file entries; original bins remain in
the corpus directory named by `corpusPath`, not duplicated in the micro folder.

Synthetic136-case validation and both flips of every actual asset pass before
any timed matrix. Since validation calls the implementations, the first measured
round may have warm JIT: retain it and call it the first measured batch after
validation, not a true compiler/renderer cold start. There are no discarded
warmups, outliers or GC samples and no per-variant GC. Each variant processes
identical assets, orientations and repetitions, allocates all output masks and
uses the same32-slot output ring and cheap sink. Timer excludes hashing, exact
comparison, metadata work, serialization and uniform task yields.
Both flipY parameters use the same original top-down corpus; this timing is not
an actual row-flipped cache-recovery buffer benchmark. Recovery equivalence is
checked separately by the semantic matrix.

Record aggregate, per-asset and both coverage subgroups. Sparse is a fixed
zero-alpha eight-pixel block fraction >=.5; dense is <.5. A bin with no actual
samples is explicitly empty, never filled with altered pixels or synthetic art.
Record zero-alpha pixel count, alpha>=102 count, alpha0/nonzeroRGB count and exact
all-zero-alpha block count separately: a blank picking mask can contain alpha1..101
and cannot necessarily benefit from zero-block skipping. `--dense-cutoff` changes
only reporting groups, not any sample, algorithm or aggregate weighting.

Every eight rounds rotate each implementation through every order position using
forward/reverse pairs; rounds must be a positive multiple of eight. All individual
samples, first rounds, order schedules and actual per-position counts,
calls, source pixels and cumulative output-mask bytes are stored. Equal weight
per saved sample is not runtime miss-frequency weighting. Mask capacity does not
include every JS/view allocation or establish heap peak; source buffers remain
resident and word views share their bytes. Browser CDP heaps and Node process
memory are separate non-GC observations with different scopes.

With `--engine both`, the browser/server fully exit before the Node matrix starts.
Node uses the same source bytes, shared loop and schedule. Compare variants within
each engine; Node's absolute result is not a browser substitute or frame-time
claim. Any production choice still needs source mask semantics, pixel/picking
proof and independent same-scene CPU/tail measurements.
