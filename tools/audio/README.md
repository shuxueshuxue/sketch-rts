# Private sound pack preparation and release

`prepare-war3.py` prepares a private pack from an extracted archive. The hosted pack is kept outside git at
`/opt/sketch-rts/shared/audio-packs/war3/` on `alibaba-public` (`101.201.227.31`). Nginx serves that directory
at `https://lexicalmathical.com/sketch-rts/audio-packs/war3/`, separately from code releases.
The site's `served.json` chooses `war3` as its default; do not change it when updating one sound.

Always stage a **complete** pack: `pack.json`, optional `extras.json`, and every recording either manifest references.
For a small supplement, copy the current hosted pack into a new staging directory, then overlay the changed files.
Run encoding on mac1 or A100. The A100 staging directory must be under your own `/codegeex/jeffry/` directory.

Check the staged pack without uploading anything:

```sh
node --import tsx tools/audio/validate-pack.ts /path/to/staged/war3
```

The validator merges the core and extras and uses the game's `readSoundPack`, including shared unit-name migration.
It checks event names, unit kinds, volumes, pitch, variants and the presence of referenced audio files.
Malformed extras are a release failure; they must not silently fall back to the core.

After review and authorization to release, use the guarded upload:

```sh
RSYNC_RSH="ssh -F $HOME/YellowPage/ssh_config" \
  bash tools/audio/publish-pack.sh /path/to/staged/war3 \
  alibaba-public:/opt/sketch-rts/shared/audio-packs/war3/
```

The wrapper validates before its first `rsync` and stops with a nonzero exit code on failure. It uploads recordings
before the manifests, updates manifests with `--delay-updates`, and preserves other destination files.
If the reviewed complete pack omits `extras.json`, it removes that optional destination manifest so an older supplement cannot remain active.
It requires Node with this checkout's dependencies, rsync, and SSH write access to the destination (currently root).
Back up the current manifests first. A code merge deploys through `.github/workflows/production-deploy.yml`;
that workflow does not upload private audio. Refresh the game after a release to load updated manifests and clips.

Unit-name changes belong in `src/shared/unit-name-migration.ts`. Saved games and sound pack `kinds` use that same
mapping; if both a current name and its old name occur in one event, the current-name entry wins.

Validation tests:

```sh
npx vitest run src/client/sound.test.ts src/client/sound-packs.test.ts \
  src/shared/unit-save-migration.test.ts tools/audio/validate-pack.test.ts
```
