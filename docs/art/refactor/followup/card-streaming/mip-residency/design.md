# Original mip residency and single-raster cache

Cache allocation freeze: `55d6b3b`, including the single-raster identity change
from `3205988` and the demand-sized allocation repair. The subsequent ordered
multi-bank renderer separates resident pages from per-frame draws; its final
production commit and GPU acceptance are recorded by the enclosing validation.
This note describes the design and its limits. It does not claim final timing, whole-process memory or
hardware GPU improvement; those require the enclosing formal measurements.

## Artwork identity and resident state

The canonical card key is the original painted-raster identity plus source
density and authored tile size. Colors, poses, facing, equipment and variants
remain represented by their existing paint identity. `baseMip` is not another
artwork identity. One canonical key maps to one `Card`, whose `baseMip` records
the finest chain currently resident.

The full-resolution CPU raster cache uses this same original identity. Changing
the resident mip does not create another CPU drawing or another retained GPU
card. Different units may bind instances of the same card. Their matrices,
IDs, foot anchors and opacity remain per-instance values.

The original source density policy is unchanged: density two below zoom .65,
otherwise density four. Full source RGBA is painted, read back, flipped and
compressed exactly as before. Residency chooses a tail of that original GPU
mip chain; it does not repaint at a lower density or resize the canvas.

## Reusing and promoting a card

If an existing card starts at mip zero and the new request permits mip one,
the complete existing chain already contains the required samples. The card
is reused without another slot, upload or mask. This policy does not immediately
downgrade a previously promoted card. Normal eviction and subsequent new-pose
requests can populate smaller chains later.

If the existing card starts at mip one and any current instance needs mip zero,
the card must be promoted before rendering. `add` protects the old card from
eviction. `finish` groups pending requests by original key and chooses the
smallest requested `baseMip` for each key. Coarse and fine requests for one
uncached source therefore cause one upload of the finest required chain.

Promotion prepares the new layer while retaining the old layer and bindings.
Only after the uploader successfully submits the entire native tail does it
publish the new card, move all current-frame bindings from the old card, clear
the old layer and replace its mask accounting. Pending instances then bind the
same new card. There is no frame in which an instance requesting fine detail is
silently displayed with the old coarse chain.

Every `add` assigns its ordinal before testing the cache. Warm hits and pending
requests fill reusable instance records indexed by that same ordinal. Promotion
changes the affected records' card pointers after transfer succeeds. Compaction
uses the same rebind operation. Neither operation reorganizes the submission
sequence, matrices, foot anchors or opacity.

## Ordered multi-bank drawing

Resident pages own only their texture, layer cards, upload state and last-used
frame. They own no geometry, material or mesh. After uploads, promotions,
compaction and unused-page cleanup, drawing walks the original instance order.
It greedily adds resident pages to a chunk; an already bound page can recur
anywhere in that chunk. Encountering a ninth distinct page starts the next
chunk. A page can also recur in later chunks without another cached texture.

Each reusable draw chunk owns one instanced mesh and color/depth/distance
materials. Per-instance `cardBank`, `cardLayer`, `cardRect`, matrix and optional
opacity select the original samples and geometry. Chunk IDs and original card
references provide the corresponding alpha-mask lookup and raycast mapping.
Ray intersections retain their actual authored-plane distances; bank indices
are never substituted for instance IDs.

A public `maxTextureBanks` policy supports one through eight banks. The one-bank
reference is the same ordered renderer with a smaller bank limit. It is not a
second rendering implementation. `World3DLayer` caps the production limit using
public renderer texture-unit capabilities while reserving four units for other
samplers. One bank retains the original implicit texture expression. Multi-bank
shaders calculate UV derivatives before the bank branch and use explicit
`textureGrad` in every color, depth and point-distance pass. Strict GPU proofs
must check this sampling change, including mip filtering and shadows.

The color renderer gets a strictly increasing, bounded fractional `renderOrder`
within the caller's pass level. Every chunk, including chunk zero, lies strictly
between `policyBase + .0001` (inclusive) and `policyBase + .001`. Native meshes
at the exact same base therefore precede every painted chunk regardless of
material creation time or the one/eight-bank segmentation. The shared group
retains default group order,
and its children are arranged in chunk order for shadow traversal. A page's
material creation time and cache state no longer choose which same-depth card
is drawn last. Chunk mesh growth repairs children order; a chunk may never be
sorted merely by its first unit or resident page.

Chunk buffers and materials are reused. All compiled program variants share
stable sampler binding objects; custom sampler getters read the current bank
array, including direct shadow submissions. Finishing refreshes the ordinary
map uniform. Beginning a frame hides old chunks and clears their IDs, card/page
references and all sampler bindings, so an unsuccessful fine promotion cannot
expose a stale coarse frame or retain a disposed texture through the draw pool.
Unused chunks expire after 120 frames, and an empty resident cache releases
the remaining pool. Context invalidation releases it and the next successful
frame reattaches the drawing group.

## Two failure transactions

A failed promotion leaves the original card, original mask and current coarse
bindings intact. The new card is not published and the old layer is not cleared.
`finish` throws, so `World3DLayer.draw` does not issue its final scene render for
that incomplete frame. Pending painter closures are released in `finally`.
The next ordinary frame resubmits its requests and rebuilds the finest-mip and
allocation plan; retrying `finish` alone does not replay discarded requests.

In-place compaction has a different destination risk. It copies visible sources
into existing inactive holes. Source cards stay alive until every copy succeeds.
If any copy fails, planned warm destination identities are invalidated because
their mip chains might have been partially overwritten. Visible sources remain
valid for retry. No active source is also a copy destination.

The uploader separately marks its full-source scratch for complete recovery
after a failed transfer. It cannot compare a partly committed CPU raster with
GPU state and incorrectly skip clearing or uploading changed pixels.

## Actual allocation and demand planning

The budget remains 12 × 1024 × 1024 **allocated base pixels**, including unused
array layers. Mip storage is counted separately with its exact native sizes.
Occupancy alone cannot describe real allocation.

Below budget, the ordinary sixteen-layer warm pages and smaller budget tail
remain unchanged. This includes empty-artwork batching: thirty-two empty cards
still occupy two sixteen-layer pages; drawing may bind both pages in one chunk.

Above budget, a page may be necessary because every compatible warm layer is
already used by the current frame. The former fixed sixteen-layer allocation
could reserve large arrays for just one or two requests of a new mip size.
Single-raster identity did not repair that separate capacity waste.

`finish` now plans unique uploads after finest-mip aggregation. It groups them
by actual requested resident size, `sourceSize / 2**baseMip`, so a native 256px
source and a 512px source starting at mip one share the same bin. A required
over-budget page has at most sixteen layers and at most the remaining unique
upload demands for that bin. Compatible free slots and evictable warm cards
are still reused first. Every successful source upload consumes its planned
demand once; duplicate instances do not consume it again.

A newly discovered empty drawing uses the existing 16px, mip-zero domain.
Above budget its new page has one layer. It consumes its original planned
source-size demand, rather than subtracting from other genuine 16px requests.
Empty discovery can leave padding reserved by an earlier allocation; planning
does not inspect future painter output in advance. The cache still permits the
full visible working set to exceed the soft budget.

Compaction uses existing inactive holes and retains unmodified warm cards in
kept pages. It does not create a temporary destination texture or change its
severe-fragmentation threshold to disguise allocation waste. Completely empty
old pages are removed after successful promotion.

## Original samples, geometry and picking

The full-source scratch generates the original native sRGB mip chain. An array
starting at source mip `N` receives source level `N + destinationLevel` through
the public Three.js transfer API. The array does not regenerate mips from its
smaller base. Integer rebasing, exact RGBA dimensions and every native tail
extent are validated before any GPU transfer.

UVs, authored tile size, float32 card-rectangle endpoints, foot anchor, geometry,
filtering, anisotropy, cutout threshold and shadow materials retain their
existing definitions. `Card.sourceSize` preserves the original alpha mask
dimensions; picking continues to use the original source-alpha threshold.
GPU resident dimensions are never substituted for mask dimensions.

Upload scratch remains full-source sized. Several source sizes can share a
resident-sized page, and one source size can serve differently sized pages for
different artwork. Page removal releases a source scratch only when remaining
cards no longer reference that original source size. The uploader also retains
its bounded five-size LRU. Final disposal releases the remaining scratch state.

## Color and shadow eligibility

`cardBaseMip` evaluates the original affine quad through the actual updated
orthographic camera matrices. It measures the maximum singular value of the
UV-to-physical-pixel Jacobian, including reflection, rotation, shear,
nonuniform scale and the actual float32 geometry endpoints.

Every sampling pass contributes to the bound. Living cards include the color
framebuffer at its physical DPR and the actual 2048px sun shadow camera. Deck
remains do not cast shadows and use their color pass. A small window can demand
more shadow detail even when its color image is small. The maximum card scale,
custom models, resize and DPR changes cannot be inferred from zoom alone.

The candidate keeps a complete additional source level and a 1% derivative
allowance, caps the starting level at four, and requires exact integer rebasing.
Missing passes, perspective, singular or unsupported projections and invalid
inputs retain mip zero. Future shadow lights or shader deformation must extend
the pass/projection model or retain the full chain; the present gate models the
current color and sun passes.

The anisotropic algorithm is implementation dependent. The guard and numerical
margin are conservative tested candidates, not a specification guarantee for
every driver. The [independent prototype](../mip-tail-review.md) records strict
color and sun-pass pixel checks on Chromium / SwiftShader, including rejected
fixed-drop cases. [Khronos specifies the implementation-dependent filtering
scheme](https://registry.khronos.org/OpenGL/extensions/EXT/EXT_texture_filter_anisotropic.txt).
Hardware GPU validation remains necessary before claiming universal pixel
equivalence or hardware performance.

## Evidence and remaining work

The prior multi-tier candidate is archived in
[camera-qa-coexisting.zh.md](camera-qa-coexisting.zh.md). Its zero pixel difference
did not make its increased memory acceptable. The subsequent single-raster
candidate also exposed oversized pages when sparse new mip bins were allocated;
this is why demand-sized over-budget allocation is part of the design.

The allocation repair passed 42 painted-card tests and TypeScript checking.
After ordered multi-bank integration, 53 painted-card tests, 10 shader helper
tests and 20 world-layer integration tests passed. TypeScript checking passed
after the final native-order boundary repair. Coverage includes original one-pixel picking, three authored domains,
finer reuse, finest pending aggregation, promotion/retry, binding order and
matrices, shared-source scratch lifetime, six unique uploads across three
resident bins, duplicate tiers, genuine 16px bins after empty discovery, and
unchanged below-budget empty batching, warm/pending submission order, a ninth
bank boundary with recurring pages, one-bank cross-page interleaving, real
nearest-hit distances, compaction order and compiled color/shadow sampler
cleanup. These establish cache and transfer
invariants; they are not substitutes for final whole-scene pixel and timing
validation.

Full source painting, readback, CPU recovery, original masks and scratch storage
remain. More warm smaller arrays can retain more original masks. Promotion
temporarily owns old and new storage; driver reclamation need not coincide with
the program's dispose counters. Rebind work is proportional to affected card
bindings, and larger visible sets can exceed the budget. These costs and
transition peaks belong in formal measurement alongside steady state.

The previous page-owned renderer failed strict ordering comparisons despite
unchanged scene facts: three pixels in a mixed camera battlefield, 33 pixels
in real battle frame 8, and a different battle frame after a diagnostic
minimum-page-index sort. Resident-page material IDs changed ordering of
same-depth overlapping artwork. That diagnostic sort was rejected because it
cannot preserve arbitrary cross-page interleaving. The raw failures remain
archived; they are not rounded away or described as original pixel equivalence.
The ordered renderer establishes a new validation epoch, applying the same
stable ordering to both one-bank reference and multi-bank candidate.

`drawBufferBytes` separately estimates retained geometry and instance typed
arrays, with `drawCapacity`, active/pooled draw counts and the bank limit.
Existing `ownedCpuBytes`/`ownedGpuBytes` retain the earlier raster/cache/texture
accounting scope for reproducible comparisons; they do not include those draw
buffers, driver objects, canvas stores or whole-process heap. Reporting a total
must account for both scopes rather than claiming the pool is free.

Final acceptance must retain the unfavorable earlier results and compare the
same scenes and camera histories: raw RGBA including transparency, first-frame
promotions and returns, picking, facts, steady and transient resource ownership,
submission/render time distributions, and separately measured simulation.
Program-owned texture accounting is not process RAM or measured hardware VRAM.
