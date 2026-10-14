# Authored paint identity: CPU RGBA proof

The World3D unit-card key now omits inputs that the corresponding stock painter
does not read. The original team color, pose, facing and appearance still reach
the painter unchanged. No painter, animation tracker, simulation or AI behavior
was modified.

Scope:

- The 21 stock creature painters use their authored material colors rather than
  `CreatureLook.team`. Their owner-color cache dimension is shared. Their pose,
  variant, aim and carried-weapon dimensions remain unchanged.
- `siegeRam`, `ballista`, `catapult` and `organGun` read attack recoil and walking
  wheel phase. Their static idle/cast/work keys share one drawing; attack keys
  retain the recovery frame and walking keys retain the wheel frame. Ignored
  attack variants, aim bins and carry parameters do not create another drawing.
- Figure colors and action variations remain separate. Opaque story variants,
  including an explicitly provided empty variant string, opt out of these rules.
- The caller retains facing, density, appearance and the original authored
  domain. The downstream card cache includes domain and density in its identity.
  The Canvas fallback cache was not generalized in this change.

## Executed verification

Command: `npx vitest run src/client/art/paint-identity.test.ts`

Vitest 2.1.9 completed with exit 0: **5 tests passed**, total duration 68.62 s.
This was CPU drawing with `@napi-rs/canvas`; no WebGL rendering or GPU timing was
performed by this proof. Console output was returned by the execution tool; a
separate raw log file was not saved. The counts below are from that completed run.

| Matrix | Whole-domain RGBA comparisons | Compared pixels | Maximum channel difference |
|---|---:|---:|---:|
| All 21 creatures, 39 poses, densities 2/4, both facings, three team colors | 6,552 | 1,525,248,000 | 0 |
| Four siege painters, six attack frames, three variants, 13 aim bins, densities 2/4 and both facings; static/walk/cast/work/carry boundaries | 4,192 | 1,207,459,840 | 0 |

Creature poses include every frame of idle, walk, attack, cast and work, with
representative attack variants and upward/level/downward aim, plus carried
weapon states. Team colors were `#b79048`, `#5d8e68` and `#ad5c46`.

Each comparison uses the same full original domain selected by
`actionPaintSize(pose, kind)` at the same density and facing. The siege canonical
reference is drawn into the original pose's domain as well. All RGBA bytes are
compared, including RGB underneath transparent pixels. Nonempty controls verify
that the reference art is present; alpha-mask equality alone is not used.

Negative controls confirm that actual figure pixels differ between team colors,
and that a horizontally reversed right-facing figure is not the authored
left-facing figure: the painter deliberately changes its light and shadow by
facing. Key tests retain those distinctions and opaque story-variant inputs.

After this run, only the test's TypeScript canvas type was corrected from an
overloaded `ReturnType<typeof createCanvas>` to the explicit `Canvas` type.
`npx tsc --noEmit` then completed with exit 0. The runtime proof was not repeated
for that type-only correction.

## What this proves

This establishes exact CPU base-image equality for the tested ignored inputs.
It does not establish a memory reduction amount, rendering speedup, browser
Canvas equality with native Canvas, or final WebGL frame/shadow equivalence.
The root lane separately runs browser frame comparisons, cache lifecycle checks
and resource measurements on the integrated renderer. Every original source
resolution, geometry endpoint, mip chain, filter and visible unit remains part
of that subsequent validation.
