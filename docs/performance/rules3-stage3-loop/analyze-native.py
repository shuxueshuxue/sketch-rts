#!/usr/bin/env python3
"""Recompute formal metrics and close original source/command bytes from payloads."""
import argparse
import base64
import datetime
import gzip
import hashlib
import json
import math
import subprocess
import time
from pathlib import Path

OUT = Path(__file__).resolve().parent
EXPECTED_COMMAND_SHA = "771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997"


def distribution(values):
    ordered = sorted(values)
    n = len(values)
    rank = lambda p: ordered[max(0, math.ceil(n * p) - 1)]
    return {"n": n, "mean": sum(values) / n, "median": rank(.5), "p95": rank(.95),
            "p99": rank(.99), "max": ordered[-1],
            "over16": sum(v > 16 for v in values), "over50": sum(v > 50 for v in values)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", help="Git repository containing the fixed source commits")
    parser.add_argument("--out", default=str(OUT))
    args = parser.parse_args()
    out = Path(args.out)
    began = datetime.datetime.now(datetime.timezone.utc).isoformat()
    clock = time.perf_counter()
    manifest = json.loads((out / "manifest.json").read_text())
    lookup = {base64.b64decode(row["originalPathBase64"]).decode(): row for row in manifest["files"]}

    def raw(name):
        return gzip.decompress((out / lookup[name]["storedPath"]).read_bytes())

    def load(name):
        data = raw(name)
        return json.loads(gzip.decompress(data) if name.endswith(".gz") else data)

    configs = [("unroll-strict-abba", "/workspace/whole-performance-abba-31-ec164", ["A1", "B1", "B2", "A2", "Bplain"], "Only private unweighted grow unroll in B; not adopted after unstable pooled regression.")]
    metrics = ["wholeMs", "simMs", "aiMs", "aiSnapshotMs", "renderSnapshotMs", "observerMs"]
    result = {}
    command_rows = []
    source_rows = []
    blob_cache = {}
    reference_names = ["/workspace/whole-performance-abba-49-31e4/B1"]
    oracle = raw(reference_names[0] + "/command-frames.jsonl.gz")
    oracle = gzip.decompress(oracle)
    assert len(oracle) == 618189 and hashlib.sha256(oracle).hexdigest() == EXPECTED_COMMAND_SHA

    def git_blobs(head, paths):
        key = (head, tuple(paths))
        if key in blob_cache:
            return blob_cache[key]
        data = subprocess.check_output(["git", "-C", args.repo, "cat-file", "--batch"],
                                       input=("\n".join(head + ":" + path for path in paths) + "\n").encode())
        cursor = 0
        values = {}
        for path in paths:
            end = data.index(b"\n", cursor)
            header = data[cursor:end].split()
            assert len(header) == 3 and header[1] == b"blob"
            size = int(header[2]); cursor = end + 1
            values[path] = data[cursor:cursor + size]; cursor += size
            assert data[cursor:cursor + 1] == b"\n"; cursor += 1
        assert cursor == len(data)
        blob_cache[key] = values
        return values

    def close_run(directory, require_ticks=True):
        env = load(directory + "/environment.json")
        summary = load(directory + "/summary.json")
        command = gzip.decompress(raw(directory + "/command-frames.jsonl.gz"))
        assert command == oracle
        frames = [json.loads(line) for line in command.splitlines()]
        assert len(frames) == 14400 and sum(r["frame"] is not None for r in frames) == 612
        assert [r["tick"] for r in frames] == list(range(14400))
        for field, expected in {"ticks":14400, "finalTick":14400, "frames":14400, "nonEmptyFrames":612,
                                "commandLogBytes":618189, "commandLogSha256":EXPECTED_COMMAND_SHA,
                                "finalChecksum":"7d94a5e8", "rulesVersion":3, "checksumVersion":18}.items():
            assert summary[field] == expected
        command_rows.append({"directory":directory, "originalHead":env["gitHead"], "bytes":618189,
                             "completeBytesEqualBothReferences":True, "checksum":"7d94a5e8"})
        if args.repo:
            archived = {path: body.encode() for path, body in load(directory + "/source-inputs.json.gz").items()}
            pins = env["sourceInputs"]; paths = [p["path"] for p in pins]
            assert len(paths) == len(set(paths)) == len(archived) == 241
            assert set(paths) == set(archived)
            fixed = git_blobs(env["gitHead"], paths)
            for pin in pins:
                body = archived[pin["path"]]
                assert body == fixed[pin["path"]]
                assert len(body) == pin["bytes"] and hashlib.sha256(body).hexdigest() == pin["sha256"]
            if directory + "/probe-source.ts" in lookup:
                assert hashlib.sha256(raw(directory + "/probe-source.ts")).hexdigest() == env["probeSha256"]
                assert hashlib.sha256(raw(directory + "/runtime.mjs")).hexdigest() == env["bundleSha256"]
            source_rows.append({"directory":directory, "head":env["gitHead"], "sourceInputCount":241,
                                "archivedOriginalBytesEqualFixedGitBlobs":True,
                                "esbuildBytesMeaning":"Transformed input length, not the original source byte length."})
        return summary

    for name, origin, labels, scope in configs:
        per = {}; rows = {}
        for label in labels:
            directory = origin + "/" + label
            summary = close_run(directory)
            ticks = load(directory + "/ticks.json.gz"); rows[label] = ticks
            assert len(ticks) == 14400
            assert all((row["tick"], row["tickAfter"], row["mod15"]) == (i, i + 1, i % 15) for i, row in enumerate(ticks))
            parts = {"all":ticks}
            if label != "Bplain":
                parts.update(planning=[r for r in ticks if r["ownerPlans"]], nonplanning=[r for r in ticks if not r["ownerPlans"]])
            stats = {part:{m:distribution([r[m] for r in group]) for m in metrics} for part, group in parts.items()}
            whole = stats["all"]["wholeMs"]
            per[label] = {"distribution":stats, "targetPassed":whole["p99"] <= 16 and whole["max"] <= 50,
                          "maxTick":max(ticks, key=lambda r:r["wholeMs"]),
                          "keyTicks":[ticks[t] for t in [0,1859,5280,6990,9972,10960,13512]],
                          "spikesOver50":[r for r in ticks if r["wholeMs"] > 50],
                          "spikeTicksOver16":[r["tick"] for r in ticks if r["wholeMs"] > 16],
                          "memory":summary["memory"], "winner":summary["winner"]}
        groups = ["A", "B", "C"] if "C1" in labels else ["A", "B"]
        pooled = {}; comparisons = {}
        for group in groups:
            ticks = rows[group + "1"] + rows[group + "2"]
            parts = {"all":ticks, "planning":[r for r in ticks if r["ownerPlans"]], "nonplanning":[r for r in ticks if not r["ownerPlans"]]}
            pooled[group] = {part:{m:distribution([r[m] for r in subset]) for m in metrics} for part, subset in parts.items()}
        pairs = [("A", "B"), ("B", "C"), ("A", "C")] if "C" in groups else [("A", "B")]
        for before, after in pairs:
            aa = pooled[before]["all"]["wholeMs"]["mean"]; bb = pooled[after]["all"]["wholeMs"]["mean"]
            runs = []
            for n in [1, 2]:
                a = per[before + str(n)]["distribution"]["all"]["wholeMs"]["mean"]
                b = per[after + str(n)]["distribution"]["all"]["wholeMs"]["mean"]
                runs.append({"before":before + str(n), "after":after + str(n), "deltaMs":b-a, "benefitPercent":100*(a-b)/a})
            comparisons[after + "-minus-" + before] = {"pooledBenefitPercent":100*(aa-bb)/aa, "pairs":runs}
        result[name] = {"origin":origin, "scope":scope, "perRun":per, "pooled":pooled, "comparisons":comparisons}
    for reference in reference_names:
        close_run(reference, False)
    close_run("/workspace/whole-performance-mapA-tick0-v10")
    runtime_epoch_closure = None
    if args.repo:
        paths = [p["path"] for p in load("/workspace/whole-performance-abba-31-ec164/A1/environment.json")["sourceInputs"]]
        old = git_blobs("49e07caa1657687247e6b58180c7b641911f6512", paths)
        current = git_blobs("31e4e8ba44c48efbbbf7ec3594c93e7537b6dba8", paths)
        rejected = git_blobs("ec164a6e3ec89abb3a36ea6288bd23e310685287", paths)
        shipped = git_blobs("618f9f5170164aa33d1e21443e86e64fb14d38f8", paths)
        differences = lambda a,b: sorted(p for p in paths if a[p] != b[p])
        assert differences(old,current) == ["src/shared/ship-navigation.ts", "src/shared/ship-planning-job.ts"]
        assert differences(current,rejected) == ["src/shared/terrain.ts"]
        assert differences(current,shipped) == []
        runtime_epoch_closure = {"sourceInputCount":241, "old49ToMap31Differences":differences(old,current),
                                 "map31ToRejectedEcDifferences":differences(current,rejected),
                                 "map31ToShipped618Differences":differences(current,shipped),
                                 "scope":"Complete fixed native runtime input bytes; Git49/31/ec/618, not new 618 benchmark or all repo files."}

    execution = {"startedAt":began, "endedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),
                 "wallSeconds":time.perf_counter()-clock}
    answer = {"schema":1, "datasets":result, "allRawSamplesRetained":True, "removedOutliers":0,
              "tickZeroRetained":True, "plainExcludedFromPooling":True,
              "method":"nearest-rank ceil(n*p)-1; sparse memory is not continuous peak/allocation/GC evidence",
              "commandByteClosure":command_rows, "sourceByteClosure":source_rows,
              "wholeTargetPassed":False, "runtimeEpochClosure":runtime_epoch_closure, "execution":execution}
    target = out / "analysis.json"
    encoded = json.dumps(answer, ensure_ascii=False, indent=2) + "\n"
    if target.exists():
        previous = json.loads(target.read_text())
        previous.pop("execution", None); stable = dict(answer); stable.pop("execution", None)
        assert previous == stable
    else:
        target.write_text(encoded)
    print(json.dumps({"verified":True, "formalRuns":5, "commandLogs":len(command_rows),
                      "sourceRunsCompared":len(source_rows), "wholeTargetPassed":False, "runtimeEpochClosure":runtime_epoch_closure, "execution":execution}))


if __name__ == "__main__":
    main()
