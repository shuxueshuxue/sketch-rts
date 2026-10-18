# Evidence outside the repository

Raw evidence does not live in git: archives, traces, frame dumps, videos and large images. A PR keeps its write-up and
compact before/after images (each file at most 1.5 MB; `scripts/check-file-sizes.sh` enforces it in CI).

## Where it is

- Store: the A100 machine (`zhipu-a100-102` in the YellowPage ssh config), under `/codegeex/jeffry/sketch-rts-evidence/`.
- `docs-at-3504f817/` holds the 8,346 files (2.45 GB) taken out of `docs/` on 2026-10-18, at their paths as of commit
  3504f817. All of `docs/art/refactor/` except its `.md` write-ups is there, together with every other `docs/` file
  that was an archive, a video, a JSON or text dump over 200 KB, an image over 300 KB, or any file over 1 MB.
  `docs-at-3504f817/SHA256SUMS` lists each file's checksum. It was compared against git after the copy, and all 8,346
  match.

A write-up that links to one of these files now has a dead relative link. The file is at the same path under
`docs-at-3504f817/`.

## Getting a file back

```sh
rsync -a -e "ssh -F ~/YellowPage/ssh_config" \
  zhipu-a100-102:/codegeex/jeffry/sketch-rts-evidence/docs-at-3504f817/<path under docs/> ./
```

Every file is also still in git history before the commit that removed it (`git show 3504f817:<path>`).

## New evidence

`bin/sketch evidence push <file|dir> [--pr N]` copies it to the same store, under `sha256/<hash of its bytes>`, and
writes `<path>.evidence.json` beside it: a small pointer to commit (and cite in the PR) instead of the file. A
directory travels as one gzipped tar. `bin/sketch evidence get <pointer>` fetches it back and checks the hash.
`bin/sketch evidence check` runs the same size check as CI on the current branch. The A100 must have
`"evidence": "/codegeex/jeffry/sketch-rts-evidence"` in `~/.config/sketch/machines.json` (see
`tools/cli/machines.example.json`).
