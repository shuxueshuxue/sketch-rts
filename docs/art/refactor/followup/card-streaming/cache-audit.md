# Painted-card residency audit

Baseline production source: `f87c3b7` in the frozen
`/tmp/sketch-card-streaming-baseline` checkout. This audit concerns card
residency, page allocation and compaction. It does not modify simulation, AI,
unit count, camera visibility, authored pixels, density, picking resolution or
mip domains. The 12 × 1024 × 1024 allocated-pixel budget is unchanged.

## What the old policy did

The old sixteen-layer pages align exactly with the budget for 512px cards:
three pages contain 48 layers and consume 12,582,912 allocated base pixels.
For 640px cards a page consumes 6,553,600 pixels. Two pages exceed the budget
by 524,288 pixels even though twenty live poses only consume 8,192,000 pixels.
For the current 176 × 4 = 704px action domain the mismatch is larger: a
sixteen-layer page consumes 7,929,856 pixels, while twenty live poses still
fit inside the unchanged budget at 9,912,320 pixels.

A single visible unit visiting its seventeenth distinct action pose allocates
the second page. The old compactor then sees two pages and one active pose,
allocates a third page, copies that active pose, and deletes both old pages.
All sixteen warm poses disappear. Repeatedly visiting twenty poses therefore
uploads every pose again even though the logical pose set fits the budget.

The accounting itself was correct: GPU allocation includes empty array layers,
so replacing allocated pixels with occupied-card pixels would hide real
storage and enlarge the effective budget. Choosing an already-allocated empty
layer before evicting a warm card is also correct; filling that hole costs no
additional texture allocation. The defect is the coarse page capacity combined
with destructive compaction, rather than either of those choices alone.

The existing pending-request pass already protects every current-frame warm
key before processing misses. That protection remains necessary when the
visible working set exceeds the soft budget and is retained.

## Implemented policy

New pages normally contain sixteen layers. The final page inside the budget
uses the number of full-resolution layers that still fit: sixteen plus fourteen
for a standalone 640px domain, or sixteen plus nine for 704px. When every
compatible layer is in use this frame, allocation may still exceed the soft
budget to display the entire required working set. No visible card is evicted.

Compaction keeps existing pages with many active poses and copies only active
poses in the other pages into inactive holes of the kept pages. A short tail
page is exchanged for a larger destination when required to fit the active
set. No new destination texture is created. Unmodified warm cards in the kept
pages survive; warm cards in removed pages or overwritten holes are discarded.

Every source remains alive until all copy submissions succeed. No current-frame
source is a destination, so a partial copy leaves the visible source cards
intact. After a copy failure, all planned inactive destination identities are
invalidated conservatively: partially written mip chains cannot subsequently
be mistaken for the old warm pose. A retry can use the original visible sources.
Successful copies publish card maps and instance entries together before
removing source pages. Pick masks travel with their exact source card.

## Controlled cache-policy results

`scripts/art-card-cache-diagnostic.ts` runs the actual baseline class with a
mock Canvas readback and mock GPU transfer contract. It checks the metadata
replay against actual rasterization counts, page creation, final cards/pages,
allocated mip bytes, compaction counts and full scratch-upload bytes.
Compressed CPU recovery is disabled in this probe so a second cache cannot
mask GPU residency misses. The image dimensions and all mip domains remain
unchanged. The candidate replay models only the residency change; its
`uploadBytes` counts the full requested RGBA domains, before the separate
partial-upload optimization.

These are exact request/allocation counts, **not GPU timings or FPS predictions**.
The texture peaks below include array mip allocations only, excluding upload
scratch textures, Canvas backing, masks and browser/driver memory.

| Identical request sequence | Layer uploads before → candidate | Compacted layers before → candidate | Array texture peak before → candidate |
| --- | ---: | ---: | ---: |
| One visible unit, 20 recurring 640px poses, 3 cycles | 60 → 20 | 3 → 0 | 104.86 → 65.54 MB |
| One visible unit, 20 recurring 704px poses, 3 cycles | 60 → 20 | 3 → 0 | 126.88 → 66.08 MB |
| One visible unit, 40 recurring 512px poses, 3 cycles | 40 → 40 | 0 → 0 | 67.11 → 67.11 MB |
| One visible unit, 31 recurring 640px poses, 3 cycles | 93 → 93 | 5 → 0 | 104.86 → 65.54 MB |
| 64 poses followed by four survivors across four pages | 64 → 64 | 4 → 3 | 111.85 → 89.48 MB |
| 100 visible distinct 640px poses, unchanged for four frames | 100 → 100 | 0 → 0 | 244.67 → 240.30 MB |

The 31-pose counterexample is deliberate: only thirty 640px layers fit this
budget, so a repeated sequence of thirty-one poses still churns. This policy
removes the sixteen-layer capacity cliff and temporary compaction allocation;
it does not solve every animation working-set problem.

## Replay of actual viewport requests

The independent browser diagnostic in `/tmp/card-trace/before.json` records
443 frames of the real viewport fixture, including preparation, warmup, CPU
samples, three real completion samples, and empty-camera/return probes.
The main batch received 44,200 instance requests with 153 unique identities,
using 512px and 704px raster domains. The empty corpse batch has no requests.
This intrusive diagnostic is not the formal timing run. Its shorter final
completion sequence differs from the earlier formal viewport report, so its
final pose counts cannot be compared directly with that report's 627
rasterizations / 61 final cards.

Replaying these exact requests verifies the original production counts:
635 layer uploads, 64 compacted layers, nineteen initialized pages and 48 final
cards. The residency candidate gives 648 uploads, 27 compacted layers, fifteen
initialized pages and 51 final cards. Its array texture allocation peak falls
from 171.61 MB to 110.80 MB.

**The actual request trace has thirteen more uploads with this residency
policy**, a 2.05% increase. It is a memory/compaction improvement, not a demonstrated
cache-hit improvement for that scene. Of 635 original uploads, 153 correspond
to first-seen identities and 482 are repeat uploads; the candidate repeats 495.
The remaining action working-set churn must stay visible in the acceptance
report. The separate upload-region and paint-identity changes require their
own real browser counters and image proof; they cannot be credited to this
isolated residency replay.

## Reproduction and validation

```sh
node --import tsx scripts/art-viewport-benchmark.mjs \
  --source /tmp/sketch-card-streaming-baseline \
  --fixture art-viewport-card-trace.js --hidden 0 --repeats 1 \
  --real-frames 3 --skip-simulation --out /tmp/card-trace/before.json
node --import tsx scripts/art-card-cache-diagnostic.ts \
  --source /tmp/sketch-card-streaming-baseline \
  --trace /tmp/card-trace/before.json \
  --out docs/art/refactor/followup/card-streaming/cache-diagnostic.json
npx vitest run src/client/world3d/painted-card-batches.test.ts
```

Add `--candidate-source "$PWD"` to the replay command to check candidate
metadata against the actual new class as well. The mock candidate's scratch
bytes reflect the separately implemented uploader's identical-image handling;
those bytes are not a realistic-art bandwidth measurement.

The 21 painted-card tests pass. They cover both 160/176 action domains, full
visible working sets over budget, picking/mirrored transforms, current-frame
warm protection, context loss, compressed recovery, release after failures,
compaction with retained warm cards, absence of a temporary page, and copy
failure/retry without corrupting visible identities. Real GPU RGBA and actual
battlefield timing are tracked in the enclosing streaming validation, outside
this mock audit.
