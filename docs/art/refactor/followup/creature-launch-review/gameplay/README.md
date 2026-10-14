# Creature world and blocked-launch component review

Four successful browser runs used the maintained local Vite/Chromium SwiftShader
launch method, sequentially. No native profiling, external-process attachment,
permission changes, simulation edits, or deployment occurred. The source roots
were `/tmp/sketch-creature-review-before-de3` and `/workspace/sketch-rts-viewport`.
Each run archives the executed fixture, full source archive/SHA manifest and
browser identity; successful runs verify source bytes remain unchanged.

## Actual world

[Before video](before/gameplay.mp4) / [after video](after/gameplay.mp4).
[After upward release](after/frame-009.png), [downward attack](after/frame-029.png),
[idle/context](after/frame-000.png). Individual 112px selection portraits and
body previews are also saved in both directories.

The same three actual units receive native attack commands toward enemies above
and below them. The production WorldPresentation, animation tracker, projectile
origin tracker, alpha/depth and shadow paths draw forty frames. All six actual
release events (two per creature) are present. Rendering leaves simulation
checksums unchanged. Forty snapshot hashes, commands, release metadata and
tracked poses are identical between arms. Both runs have GL error 0 and no
browser/console/loading errors.

Manual inspection: revised dragons retain their size and body silhouette while
showing flatter projecting muzzles and clearer swept horns. The smaller dragon
remains distinct from the adult. The turtle has separated planted near/far feet
in the idle/world and portrait views. A melee opponent naturally occludes part
of its lower-facing attack; this is actual scene depth, not an isolated pose
sheet. The existing authored mouth/release positions and action directions were
not changed by this review. This fixture does not claim corpse or mirrored-view
coverage; those require the separate asset review.

Completed-frame wall times are retained only as single-run software diagnostics:
median 166.45ms before and 188.15ms after. They include GPU completion under
SwiftShader, have no repetitions or native baseline, and do not establish a
performance improvement or regression.

## Actual paid simulation, production button component

[Before component](menu-before-fixed/menu.png) / [after component](menu-after/menu.png).
These are **component screenshots, not full live game-menu navigation**. The
production main.ts button/portrait/tooltip-dataset helpers are extracted verbatim
with TypeScript AST selection, use the actual production CSS and locale strings,
and consume the real snapshot's training projection. A review panel displays
the generated tooltip dataset; it does not exercise live hover positioning.

Two native train commands deduct 480 gold (10000 → 9520). Nine physical ships
block the pier. The harness runs the full original 240-tick training duration,
without fabricating a completed job. The completed first job remains at zero
and the second stays queued. Before/after blocked snapshots match SHA256
`10dd2682bb29d22d18d948fca6b53a75584d4f7b278899edf97cc748f9c075dc`.
Moving the blockers allows native launch and resumes the second job; those
post-launch snapshots also match. Gold stays 9520. Clicking the extracted button
emits the same cancelTraining/job ID in both arms; actual cancellation execution
is not tested here.

Manual review confirms the former misleading “Training / 100%” is now
“已造好 · 等待下水 / 待下水” and “built · awaiting launch / Ready”. The hint explains
moving blocking ships and automatic launch once space becomes available; the
queued second button stays unchanged. Both locales are legible at original
52×55px button size.

The first component attempt (`menu-before/`) failed because the harness did not
rewrite a side-effect CSS import into the isolated Vite root. Its failure and
source evidence remain intact. Only the harness was corrected; the successful
baseline is `menu-before-fixed/`.

[comparison.json](comparison.json) records equality gates and evidence hashes.
All servers and browser profiles were closed after the runs. No commits or
publishing were performed by this lane.

## Reproduce

Use new output directories; the drivers intentionally refuse to overwrite runs.

```sh
node --import tsx scripts/art-creature-gameplay-proof.mjs --source SOURCE_ROOT --out NEW_DIRECTORY/world/proof.json
node --import tsx scripts/art-launch-menu-proof.mjs --source SOURCE_ROOT --out NEW_DIRECTORY/menu/proof.json
```

## Final UI/yard overlay follow-up

The final source freeze adds the world annotation and revises tooltip wording.
Fresh evidence: [final component](menu-after-final/menu.png),
[blocked yard zh](menu-after-final/world-blocked-zh.png),
[blocked yard en](menu-after-final/world-blocked-en.png),
[cleared yard zh](menu-after-final/world-cleared-zh.png),
[cleared yard en](menu-after-final/world-cleared-en.png).
The matching old-source run is `menu-before-annotation/`; all previous runs and
failure files remain byte-for-byte untouched.

These world images call the complete production **Canvas** `drawWorld` with
`worldLabelsFor(createI18n(locale))`, actual model resources and the same real
paid snapshot used above. The yard is unselected. They do not claim WebGL yard
coverage. The added waiting text appears in both locales only while blocked;
after the actual launch it disappears and ordinary second-job progress returns.
The old version has no waiting line. Gold, queue IDs, blocked/cleared snapshot
hashes and cancel callbacks match across arms. Browser errors remain empty.

Manual inspection confirms the amber/blue state change, but original map
scenery overlaps the tiny line beneath this yard in the complete Canvas view.
This is preserved as a visibility limitation, not presented as proof of
unobstructed readability. The final component's natural-language hint is clear
in both locales. [Final comparison and exact current hashes](final-ui-comparison.json)
records the relevant production sources and captured text commands.

The earlier three-creature 40-frame WebGL result remains scoped to those actors:
creature painters, corpse painters, World3DLayer and animation source hashes are
unchanged in this final UI run. That fixture has no buildings and does not
validate the newly added shipyard annotation. No creature replay was repeated.

### Separate production overlay evidence

`overlay-before/` and `overlay-after-final/` add the actual `drawWorld` overlay
pass on the same blocked/cleared snapshots in Chinese and English. Transparent
`*-overlay.png` files contain precisely the production annotation layer, without
altering trees, units, the simulation or painting order. For example:
[blocked English overlay](overlay-after-final/world-blocked-en-overlay.png),
[cleared English overlay](overlay-after-final/world-cleared-en-overlay.png),
[blocked Chinese overlay](overlay-after-final/world-blocked-zh-overlay.png).
The expected waiting line exists only in the final blocked overlay; the
old-source and cleared overlays lack it. All runs pass, with unchanged sources
and empty browser/loading errors.

Files named `*-overlay-review-composite.png` are explicitly review composites:
the saved full Canvas frame plus its saved transparent production overlay,
at identical coordinates and size. They illustrate the annotation layer above
world scenery; they are **not new complete WebGL captures**.
[Overlay comparison and current SHA256 values](overlay-comparison.json) preserve
snapshot equality, captured commands and exact relevant source identities.

### Final readable waiting line

The earlier amber 9px waiting line was hard to read over actual trees. The final
production change adds a pale-paper backing and dark 10px text only to that
second line. One fresh run, `menu-readable-final/`, validates that final source;
no baseline or creature replay was repeated. All prior evidence is preserved.

[Final menu](menu-readable-final/menu.png),
[Chinese overlay review](menu-readable-final/world-blocked-zh-overlay-review-composite.png),
[English overlay review](menu-readable-final/world-blocked-en-overlay-review-composite.png),
[cleared overlay](menu-readable-final/world-cleared-en-overlay.png).
Manual inspection at original size confirms both waiting labels are now
legible over the tree background. After native launch, the waiting text and
its paper backing disappear; the second job's ordinary blue progress remains.
The raw full Canvas and transparent overlays for both states/locales are saved.
Composites retain the explicit Canvas-plus-overlay review scope, not WebGL.

[readable-final-comparison.json](readable-final-comparison.json) is the final
source/SHA and equality report: the old de3 baseline's blocked and cleared
snapshots and cancel callbacks still match, no browser/loading errors occurred,
and source bytes stayed stable. Creature/actor sources still match the earlier
40-frame actual WebGL proof. The browser/server window is released.
