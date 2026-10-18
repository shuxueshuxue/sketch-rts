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
  bases@N, workers@N, spent@N, trade@N, clear, hire) taken in the same games. 40 games per cell at the default.
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
