# Minimap derived-mark publication reuse

The match minimap still paints the entire world at every presentation frame. This change only avoids rerunning `createMapPresentation` (mark objects, source ID arrays, wildling clustering and sorting) when the actual local adapter has not published a new world view. It does not cull minimap contents, throttle its painting, change any simulation code, or infer correctness from an unchanged tick or entity count.

## Ownership and invalidation

The production integration is `src/client/main.ts:3345`. `deploymentRuntime.isLocalRoom(currentRoomId)` resolves the concrete local room owner through the existing runtime routing. These rooms use `LocalGameAdapter`; its `currentSnapshot` returns its own copied publication (`src/client/net/local-adapter.ts:45`) and `applyAndStep` clears that publication before every command/step (`:75`). Unit/building/resource/camp mark inputs are copied by the existing `snapshotGame`. The map landmark writes in current production are map/scenario construction, before this local adapter is created. The current main consumer paths do not mutate these mark fields.

The cache uses the local publication identity plus snapshot identity, not a general assertion that all `GameSnapshot` objects are immutable. Every unknown/mutable/no-token read rebuilds from current data and clears retained cache state. Public lockstep rooms take this live path: their engine currently creates a snapshot on each read and asynchronous checkpoints can replace a world at the same tick. This change makes no claim of reducing that public-room clone/derivation cost.

The cache retains only the current minimap marks/publication. `disconnectActiveMatch` resets it (`main.ts:1492`). The real owner lifecycle already funnels through that function:

- `activateStartedMatch` calls `disconnectActiveMatch` before assigning the new adapter/view (`:1468`).
- `openMenuRoute` calls it before releasing the active room (`:827`).
- The non-persisted `pagehide` handler calls it before closing runtime/resources and clearing `snapshot` (`:498`). A page retained in the browser back/forward cache keeps its existing owner and view as before.

Relations, cabin visibility, items, obstacles, wind, and the camera viewport continue to be read by the original minimap brush every paint. Marks are not a cached bitmap.

## Verification and scope

The focused test command passed **20 tests in four files**, and `npx tsc --noEmit` passed. The new cache tests exercise a real local command and render-time step, same-tick replacement with death/birth/movement/resource/camp changes, an unknown provider mutating the same object without changing lengths/tick, explicit republishing of the same object, reset and new scenes. The Canvas tests compare full RGBA with the unchanged builder, including live cabin, item and relation brush inputs.

`main-browser/proof.json` captures source commit **77a2c3078b1f14c02f1058dc22fd31a80f9dd314** in Chromium 151. The driver imports the real main module after `resources.initialize`; it does not initialize visual/model/audio payloads, run world rendering, or perform a complete user-click page flow. For correctness only, it suppresses RAF and controls the publication clock. A Vite transform moves the **exact byte-preserved** main derived-minimap block into a callable function and observes the marks at the original minimap brush entry.

The fixture starts genuine private rooms through `DeploymentRuntime`, calls the real `activateStartedMatch`, native frontend synchronization, input projection and `sendCommand`, and then advances the controlled clock by 50 ms. It dynamically calls `openMenuRoute` and dispatches a non-persisted `pagehide`. Those production functions themselves execute `disconnectActiveMatch` and its cache reset; the fixture does **not** directly call `cache.reset`. After owner teardown it performs a diagnostic read of the old publication only to assert that the prior mark array was released; that read is not described as normal application behavior. Starting the next room resets this diagnostic read again.

All **eight lifecycle samples** passed. The three steady samples retain mark identity 1 at tick 0; the real command creates identity 2/tick 1; the real time advance creates identity 3/tick 2; toggling relations keeps identity 3; the new map/room creates identity 4/tick 0. The original builder and cached marks match completely for every sample. Sixteen owner/relation Canvas comparisons cover **3,379,200 original RGBA bytes with zero differences**, with zero browser exceptions or failed network loads. PNG bytes were independently verified after CDP transport. These are minimap/lifecycle correctness results, not whole-app E2E, GPU correctness or FPS results.

Relevant source files, the exact transformed main, executed driver/fixture, per-image PNG/RGBA hashes and start/end source hashes are preserved alongside the proof. The first CLI attempt supplied an abbreviated expected commit to a driver requiring the complete SHA; it rejected before starting Vite/Chromium. Its stderr remains in `startup-argument-failure/stderr.log`. The successful run used the full SHA; no source changed during it.

## Reproducible CPU derivation micro

`micro.json` compares the actual unchanged builder with publication reuse on identical prebuilt 2,000- and 10,000-unit whole-world inputs. Each case has 40 publications and 120 reads, representing 20 Hz simulation publications and 60 Hz presentation reads. Input construction and correctness validation are outside timers. Twelve balanced-order rounds retain the first and slow samples; no GC runs or samples are discarded. Validation compares all 120 mark arrays for each case.

| Units | Original CPU per 120 reads | Cached CPU per 120 reads | Cache/original | Builds | Constructed final marks/source ID arrays |
| --- | ---: | ---: | ---: | --- | --- |
| 2,000 | 85.829 ms | 28.947 ms | 0.3373 | 120 → 40 | 256,080 → 85,360 |
| 10,000 | 605.242 ms | 207.356 ms | 0.3426 | 120 → 40 | 1,264,080 → 421,360 |

The counts are exact final mark objects and their `sourceIds` arrays for this unchanged builder, **not** total allocation bytes, heap peaks or GPU memory. The micro measures CPU derivation only; simulation, DOM, drawing and world rendering are excluded. It does not establish a game-frame/FPS improvement. Savings depend on how many presentation frames share each local publication; fresh publications still pay the full unchanged builder cost. The cache's source hashes match the final source used for the browser proof.

Reproduce from the repository root, using a new browser output directory:

```sh
node --import tsx scripts/art-minimap-cache-micro.ts /tmp/minimap-micro.json
node scripts/art-minimap-cache-main-proof.mjs --source . --expect-commit 77a2c3078b1f14c02f1058dc22fd31a80f9dd314 --out /tmp/minimap-main-new-run
npx vitest --run src/client/minimap-presentation-cache.test.ts src/client/frontend-world-view.test.ts src/client/net/local-adapter.test.ts src/shared/presentation.test.ts
```

## Evidence hashes

- Actual main source: `713ca93e0aff1468f5e649761057e8da03d615a413d5c4abe94173ed531171f4`
- Cache source: `d97de39bdc67bba0560409f00dff1a5e0105bbe0e482d591db2fe45883056805`
- Byte-preserved extracted main block: `57ce0f48d8d82864820681b04a5ed6dff359e5d60f97062dec31119f71afce44`
- Executed transformed main: `748c1014a136584a10eb203bd2c7ffb4741012a31a0e8af06bca6ccf6b9d1a5b`
- Executed browser driver: `885f9dc15a49a3621641b3976d23bebde9a6a13df1cca23efba8e86d939351ae`
- Executed browser fixture: `6eb291cc300ea34e79014c078c7401ac9135339d7dac9ee9834517ac9fe2f600`

Remaining cost includes per-paint cabin filtering, terrain/mark painting, public-room snapshot cloning and derivation, and all simulation/world-render work. These are outside this narrowly validated change.
