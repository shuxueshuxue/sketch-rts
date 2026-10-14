#!/usr/bin/env python3
"""Check preserved history, executed source, visual matrix and fenced captures."""
from pathlib import Path
import gzip
import hashlib
import json

ROOT = Path(__file__).resolve().parents[4]
REVIEW = Path(__file__).resolve().parent
digest = lambda data: hashlib.sha256(data).hexdigest()
read = lambda path: json.loads(path.read_bytes())
original = json.loads(gzip.decompress((REVIEW / "before-manifest.json.gz").read_bytes()))
for item in original["files"]:
    data = (gzip.decompress((REVIEW / "before-README.zh.md.gz").read_bytes())
            if item["path"] == "docs/validation/homepage-scenes/README.zh.md"
            else (ROOT / item["path"]).read_bytes())
    assert len(data) == item["bytes"] and digest(data) == item["sha256"], item["path"]

records, checks = [], []
for directory, result_file, closure_file in [
    ("browser-attempt1", "failure.json", "source-end-after-failure.json"),
    ("browser-completion", "proof.json", "proof.json"),
]:
    folder = REVIEW / directory
    inputs, results, closure = read(folder / "inputs.json"), read(folder / result_file), read(folder / closure_file)
    assert closure["unchanged"] and inputs["sources"] == results["sources"]
    for key in ["baseline", "candidate"]:
        assert inputs["sources"][key]["hashes"] == closure["end"][key]["hashes"]
    before, after = inputs["sources"]["baseline"]["hashes"], inputs["sources"]["candidate"]["hashes"]
    assert set(before) == set(after)
    assert {p for p in after if after[p] != before[p]} == {
        "src/client/menu-scenes.ts", "src/client/menu-scenes.test.ts"
    }
    for path, expected in after.items():
        assert digest((ROOT / path).read_bytes()) == expected, path
    assert digest((folder / "executed-tool.mjs").read_bytes()) == results["harnessSha256"]
    for runtime in results["runtime"].values():
        assert not runtime["errors"] and not runtime["networkFailures"]
    assert all(check["pass"] for check in results["checks"])
    checks.extend(results["checks"])
    for record in results["results"]:
        capture = record["capture"]
        assert digest((folder / capture["file"]).read_bytes()) == capture["sha256"]
        assert capture["gpuCompletion"]["available"]
        records.append(record)

reduced = [r for r in records if "paint" in r and r["paint"]["reduced"]]
ordinary = [r for r in records if "kind" in r]
assert len(records) == 48 and len(reduced) == 36 and len(checks) == 207
assert len(ordinary) == 12
for scene, length, tick in [("capital", 90, 300), ("woods", 52, 334), ("fleet", 60, 760)]:
    for width, height in [(1440, 900), (390, 844)]:
        group = [r for r in reduced if r["scene"] == scene and (r["width"], r["height"]) == (width, height)]
        old = [r for r in group if r["label"] == "before"]
        new = [r for r in group if r["label"] == "after"]
        assert len(old) == 1 and old[0]["requestedAge"] == 300
        assert old[0]["overlay"]["fadeCoverRatio"] == 1
        assert sorted(r["requestedAge"] for r in new) == [length - .1, length, length + .1, length * 2, 300]
        for record in new:
            assert record["state"]["submittedTick"] == tick
            assert record["overlay"]["fadeCoverRatio"] == 0
            assert record["paint"]["created"] == 1 and record["paint"]["runAlive"]

print(json.dumps({"historicalFilesPreserved": len(original["files"]), "screenshots": len(records),
                  "reducedScreenshots": len(reduced), "completedChecks": len(checks), "verified": True}))
