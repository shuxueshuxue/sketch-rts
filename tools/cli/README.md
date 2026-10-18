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

Every command runs in its own process group, and a run only ever kills the groups it started.

## Commands

- `test diff [--base origin/main] [--ref HEAD] [--with-local] [--on M] [files…]` runs the same vitest suite (default
  `--dir src`) on both commits. It reports only failures that are new on ref and fail again when their file runs alone
  on both sides; the others are listed as flaky (marked when the failure was about time), fixed, or already broken on
  base.
- `scripts audit [--dead] [--check]` reports which files under `scripts/` are still referenced by package.json, CI,
  src/, tools/ or a live script.
