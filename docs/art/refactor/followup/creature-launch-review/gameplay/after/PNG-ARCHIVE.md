# Exact gameplay frame archive

All 40 original encoded PNG frames are retained in the container identified by [png-archive.json](png-archive.json). Frames 0, 9, 20, 29 and 39, every portrait/body PNG, the MP4 and the existing source archive remain directly available. Original proof and encoded image SHA values are unchanged.

Run from the repository root:

```sh
python3 scripts/art-creature-gameplay-png-archive.py --verify --folder after
python3 scripts/art-creature-gameplay-png-archive.py --materialize --folder after
python3 scripts/art-creature-gameplay-png-archive.py --materialize --folder after --out /tmp/creature-after-frames
```

The independent output directory must not exist. Existing frame files must match their original SHA and are never overwritten. Every verification extracts all 40 closed, regular tar members into a temporary directory and checks their full encoded bytes against the unchanged original proof. This is evidence-storage preservation, not an image re-encoding or a performance experiment.
