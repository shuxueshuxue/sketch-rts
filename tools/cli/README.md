# sketch

One entry for the project's tooling. Design and roadmap: `docs/engineering/cli-and-commands.zh.md`.

```
npm run sketch -- <command> [options]      # or bin/sketch <command> [options]
bin/sketch <command> --help                # its options
```

Exit codes: 0 nothing found, 1 the check found something (a new failure, an unreferenced script), 2 usage or
environment error. `--json` prints one JSON object on stdout; progress goes to stderr.

## Machines

Commands that run work take `--on <machine>`. Machines are defined outside the repo in
`~/.config/sketch/machines.json` (or the path in `SKETCH_MACHINES`); copy `tools/cli/machines.example.json`. Each has an
ssh target, the one directory the CLI may write under, and a shell prelude for its environment. `local` always exists
and writes under `~/.cache/sketch-cli`.

On a machine the CLI keeps:

- `trees/<sha>`: a clean copy of a commit (everything outside docs/, and docs/ text up to 1 MB), made once and reused.
  A copy near one already there is made from it with a diff, so usually only the change travels.
- `node_modules/<lock hash>`: one install per package-lock, which copies link into.
- `runs/<run id>`: reports of a run.

A browser run (`yatu`, `shot`) also needs two fields on its machine: `ports: [from, to]`, the range it may serve on
(each run takes a port and port + 20000 for vite's HMR, both unanswered; a lane's own range on a shared machine), and
`browser: { playwright, browsersPath }`, the Playwright install it drives, which is not a repo dependency. A machine
without them refuses a browser run with exit 2.

A machine may also name an `evidence` directory: the store `sketch evidence` writes to (the A100's
`/codegeex/jeffry/sketch-rts-evidence`). Objects there are `sha256/<hash of their bytes>` and are never rewritten.

Every command runs in its own process group, and a run only ever kills the groups it started.

## Commands

- `test diff [--base origin/main] [--ref HEAD] [--with-local] [--on M] [files…]` runs the same vitest suite (default
  `--dir src`) on both commits. It reports only failures that are new on ref and fail again when their file runs alone
  on both sides; the others are listed as flaky (marked when the failure was about time), fixed, or already broken on
  base.
- `bench room [--base] [--ref] [--subjects …] [--rivals v8,v9] [--maps 20] [--metrics clear,bases@4,trade@15]` plays the
  room AIs' bench on both commits and compares wins, flipped games and the direct metrics (src/ai/benchmark/metrics.ts:
  bases@N, workers@N, spent@N, trade@N, clear, hire, upgrade@K.L, stall@N) taken in the same games. 40 games per cell
  at the default. A first-minute metric shows how many games never reached it; `--json` also carries every game's
  values (`gameMetrics`), to trace a measure to its maps.
- `replay <subject> <rival> <seed> "<match>" [--from] [--to] [--every] [--show army,general,orders,losses]` plays one game
  and prints the armies, the general and the scripts' commands every N ticks. `--fork TICK --after REF` saves the game
  and the AIs' memory at TICK on --ref and continues that moment on --ref and on --after (the AIs' thinks restart at
  the fork; commands still in flight are not carried over).
- `scripts audit [--dead] [--check]` reports which files under `scripts/` are still referenced by package.json, CI,
  src/, tools/ or a live script.
- `evidence push <file|dir> [--pr N] [--on M]` copies raw evidence (a trace, an archive, frame dumps; a directory
  travels as one gzipped tar that packs to the same bytes each time) to the evidence store and writes
  `<path>.evidence.json` next to it, a small pointer (sha256, size, name, machine, commit, PR) to commit in its place.
  `evidence get <pointer> [--out PATH]` fetches it back and checks the sha256.
- `evidence check [--base origin/main] [--ref HEAD]` runs `scripts/check-file-sizes.sh`, the same size rule CI applies to
  the files a branch adds or changes.
- `yatu <scene> [--ref HEAD] [--ref2 REF] [--sizes desktop,phone] [--locale en-US] [--with-local] [--on M]` runs a scene file in a real
  browser against each commit's own dev server and brings its shots back to `~/.cache/sketch-cli/runs/<run id>/`. Exit 1
  when the scene's own `must` failed, 2 when the environment did (busy ports, a wrong build, no CJK font for a page in
  Chinese, no Playwright).
- `shot <scene> --before REF --after REF [--at 5,30] [--sizes desktop,phone] [--locale en-US] [--out DIR] [--pr N] [--on M]` runs the same
  scene on both commits and stitches each shot before|after into one labelled webp, with the page read back on each side
  (`.before.json`, `.after.json`). They go to the evidence store and leave a pointer, or to `--out`. `--at` also shoots
  the game at those seconds after the scene ends.

## Scenes

A scene is a file under `tools/cli/scenes/` (or any path) whose default export takes a `Scene`
(`tools/cli/drivers/browser.ts`). It travels alone into the commit's copy, so it imports nothing but types. The driver
starts that copy's dev server with `ROOM_AUTOTICK=0`, checks the page is served by the commit (`/api/build`), opens the
home screen once the page has reached the server, and hands the scene:

- `room(map, seats?)`: a room built through the real menu, by that commit's own `scripts/room-ui-flow.mjs`, computers in
  the open seats, started, and paused: the match moves only when the scene ticks it (a reset keeps the pause). On a commit
  from before the pause held with a page connected (@@@room-paused), the connected page still drives the room live.
- `scenario(options)`: resets the game (`POST /api/rooms/:id/reset`), and the page loads it.
- `tick(n)`: advances the room and waits until the page shows it (reloading a page that does not follow).
- `snapshot()`, `order(playerId, command)` (a command posted for any seat), `api(url, body?)`.
- `camera(x, y, zoom?)`, `select(ids)`, `command(command)` (sent as the player, refused as the player would be),
  `screenOf(x, y)`, `click(x, y, button?)`, `drag(x0, y0, x1, y1)`, `key(k)`.
- `shot(name, clip?)` at every `--sizes` viewport, `readDom(selector)`, `must(condition, message)`, `wait(ms)`, and
  `page` (Playwright's) for anything else.

`camera`, `select`, `command` and `screenOf` use the client's debug hooks (`window.__sketchRtsDebug`, see
@@@debug-hooks), which exist only in the dev build; the driver also waits on its `ready()` (the first screen opened, no
art loading) before handing over the home screen or a started match. On a commit from before the hooks, `camera` clicks the minimap
instead and `screenOf` knows only the point the camera was just centred on; the others refuse with exit 2.

**Dev build and production build.** `yatu` and `shot` always serve the dev build (vite middleware), the one with the
hooks. A check that must be made on the production build (the static `npm run build` a deployment serves, as Room Lane's
deployed-page shots were) cannot use the hooks: drive it through the real UI only (clicks, keys, the minimap), and serve
that build yourself.
