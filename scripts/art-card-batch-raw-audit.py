#!/usr/bin/env python3
"""Offline audit of preserved card-bank raw data; never starts a renderer.

This reads existing samples and untimed counters. It does not benchmark source,
infer per-frame misses from a terminal counter, or modify original evidence.
"""
import argparse
import json
import statistics
from pathlib import Path


def distribution(values):
    ordered = sorted(values)
    return {
        "samples": len(values), "sumMs": sum(values), "meanMs": statistics.mean(values),
        **{f"p{int(p * 100)}Ms": ordered[min(len(ordered) - 1, int(len(ordered) * p))]
           for p in (0.5, 0.95, 0.99)},
        "maxMs": max(values), "over50Ms": sum(x > 50 for x in values),
        "over100Ms": sum(x > 100 for x in values),
    }


def groups(cycles):
    full, layer, residual, fresh, same = [], [], [], [], []
    for cycle in cycles:
        cpu = cycle["cpu"]
        full.extend(cpu["valuesMs"])
        layer.extend(cpu["layerValuesMs"])
        residual.extend(cpu["canvasValuesMs"])
        ticks = cpu["sampleTicks"]
        # The frozen mixed fixture starts measured samples at n114/tick38,
        # directly after warmup n113/tick37. Preserve this documented boundary.
        previous = ticks[0] - 1
        for value, tick in zip(cpu["valuesMs"], ticks):
            (same if tick == previous else fresh).append(value)
            previous = tick
    return {name: distribution(values) for name, values in
            (("full", full), ("world3D", layer), ("canvasResidual", residual),
             ("freshTick", fresh), ("sameTick", same))}


def snapshot(cards):
    resident = cards["residencySnapshot"]
    visible = [chunk for chunk in resident["chunks"] if chunk["visible"]]
    histogram = {}
    for chunk in visible:
        histogram[chunk["count"]] = histogram.get(chunk["count"], 0) + 1
    fields = ("pages", "cards", "drawChunks", "pooledDrawChunks", "drawCapacity",
              "rasterizations", "copiedLayers", "mipInitializedPages", "mipCopyCalls",
              "gpuCompactionCopyCalls", "scratchUploadBytes", "rasterWorkWallMs",
              "gpuTransferSubmissionWallMs", "ownedCpuBytes", "ownedGpuBytes")
    result = {key: cards[key] for key in fields}
    result.update(rasterStages=cards["rasterStages"], rasterCache=cards["rasterCache"],
                  pageDimensions=resident["pages"], chunkCountHistogram=histogram,
                  visibleChunkCapacity=sum(chunk["capacity"] for chunk in visible),
                  minimumInternalStatsCalls=3 * cards["rasterizations"])
    result["rasterUnattributedMs"] = cards["rasterWorkWallMs"] - sum(cards["rasterStages"].values())
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path,
                        default=Path("docs/art/refactor/followup/card-streaming/bank-order/final"))
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    records = {role: json.loads((args.root / f"mixed-{role}" / "raw.json").read_text())
               for role in ("reference", "candidate")}
    reference, candidate = records.values()
    assert reference["sourceCommit"] == candidate["sourceCommit"]
    assert all(row["variant"]["maxBanks"] == 1 for row in records.values())
    assert len(reference["cycles"]) == len(candidate["cycles"]) == 2
    comparisons = []
    for before, after in zip(reference["cycles"], candidate["cycles"]):
        assert before["cpu"]["sampleTicks"] == after["cpu"]["sampleTicks"]
        pairs = [{"sample": i, "fixtureN": 114 + i, "tick": tick,
                  "referenceMs": left, "candidateMs": right, "deltaMs": right - left}
                 for i, (tick, left, right) in enumerate(zip(
                     before["cpu"]["sampleTicks"], before["cpu"]["valuesMs"],
                     after["cpu"]["valuesMs"]))]
        comparisons.append({"cycle": before["cycle"], "pairedSamples": pairs,
                            "largestPairedRegressions": sorted(pairs, key=lambda x: x["deltaMs"], reverse=True)[:10]})
    partition = {role: groups(record["cycles"]) for role, record in records.items()}
    result = {
        "scope": "Read-only offline arithmetic on preserved 0de mixed raw; no new performance samples.",
        "sourceCommit": reference["sourceCommit"],
        "limitations": [
            "Terminal counters include prepare/warmup, CPU, and real samples; stage totals cannot be attributed to measured CPU alone.",
            "No per-frame miss/page/chunk/compact trace or GC/CPU profile exists in this formal raw.",
            "Same tick is not a warm-card guarantee: animation now changes every draw.",
            "slotMs includes the recordPeaks call immediately after slot; it is not isolated page scan time.",
            "Real submit and completion include resource preparation and driver/event-loop waiting; no hardware GPU timing is inferred.",
        ],
        "cpuPartitions": partition,
        "cpuPartitionDeltaMeanMs": {name: partition["candidate"][name]["meanMs"] -
                                    partition["reference"][name]["meanMs"]
                                    for name in partition["reference"]},
        "cycles": comparisons,
        "untimedSnapshots": {role: [{phase: snapshot(cycle[phase]["cards"])
                                      for phase in ("before", "empty", "returned")}
                                     for cycle in record["cycles"]]
                             for role, record in records.items()},
    }
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(encoded)
        print(args.out)
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
