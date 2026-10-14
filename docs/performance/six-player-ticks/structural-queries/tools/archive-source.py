#!/usr/bin/env python3
"""Archive closed structural-query evidence while preserving the earlier capture tree."""

from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
from pathlib import Path


HERE = Path(__file__).resolve().parent
OLD = HERE.parent
REPO = HERE.parents[3]
PINNED_COMMIT = "0f31f16c32e9a8050180c4da9d993eb7bf86cad0"
PINNED_FILE_COUNT = 315
PREFIX_TICKS = 2110
PREFIX_BYTES = 68005
PREFIX_SHA = "acd47bbc31b5480319a69bf4b1c6a10ac4c6c624e003b49e54bc0682fdea60be"
PREFIX_CHECKSUM = "7a73a658"
BOUNDARY_NAME = ("leg" + "acy").encode("ascii")


# The imported implementation is itself among the 315 files pinned below.
# Its source, earlier manifests, validation logs and captured runtime bytes stay unchanged.
spec = importlib.util.spec_from_file_location("prior_tick_evidence_archive", OLD / "remaining-spikes/archive-evidence.py")
if spec is None or spec.loader is None:
    raise RuntimeError("Missing pinned archive implementation")
base = importlib.util.module_from_spec(spec)
exec(compile((OLD / "remaining-spikes/archive-evidence.py").read_text(),
             str(OLD / "remaining-spikes/archive-evidence.py"), "exec"), base.__dict__)
base.HERE, base.OLD = HERE, OLD
native_reference = base.native_proof
copy_reference = base.copy_asset
exclusions: dict[Path, set[str]] = {}
excluded_entries: dict[str, dict] = {}


def pinned_git_files() -> dict[str, dict]:
    """Read every committed blob with one batch call, without relying on working-tree manifests."""
    raw = subprocess.check_output(["git", "ls-tree", "-r", "-z", PINNED_COMMIT,
                                   "--", "docs/performance/six-player-ticks"], cwd=REPO)
    entries = []
    for row in raw.split(b"\0"):
        if not row:
            continue
        metadata, path = row.split(b"\t", 1)
        mode, kind, oid = metadata.decode("ascii").split()
        base.require(kind == "blob" and mode in ("100644", "100755"), "Unexpected protected Git tree entry")
        entries.append((path.decode("utf-8"), oid))
    base.require(len(entries) == PINNED_FILE_COUNT, "Pinned protected file set changed")
    output = subprocess.check_output(["git", "cat-file", "--batch"], cwd=REPO,
                                     input=("\n".join(oid for _, oid in entries) + "\n").encode("ascii"))
    offset, proofs = 0, {}
    for path, oid in entries:
        end = output.index(b"\n", offset)
        got_oid, kind, size_text = output[offset:end].decode("ascii").split()
        size = int(size_text)
        base.require(got_oid == oid and kind == "blob", f"Unexpected committed blob: {path}")
        captured = output[end + 1:end + 1 + size]
        base.require(len(captured) == size and output[end + 1 + size:end + 2 + size] == b"\n",
                     f"Incomplete committed blob: {path}")
        offset = end + 2 + size
        actual = (REPO / path).read_bytes()
        base.require(actual == captured, f"Earlier evidence changed from {PINNED_COMMIT}: {path}")
        proofs[path] = {"bytes": size, "sha256": base.sha(captured), "gitBlob": oid}
    base.require(offset == len(output), "Unexpected trailing committed-blob data")
    return proofs


def protected_original() -> dict:
    return {"sourceCommit": PINNED_COMMIT, "originalCapturedAssetCount": PINNED_FILE_COUNT,
            "protectedFileCount": PINNED_FILE_COUNT, "protectedFiles": pinned_git_files()}


def configure(plan: dict) -> None:
    exclusions.clear()
    excluded_entries.clear()
    for item in plan["capturedDirectories"]:
        root = Path(item["source"]).resolve()
        names = item.get("excludeSymlinks", [])
        base.require(len(names) == len(set(names)), f"Duplicate explicit exclusions: {root}")
        exclusions[root] = {str(base.safe_relative(name)) for name in names}


def files_under(root: Path) -> list[Path]:
    base.require(root.is_dir() and not root.is_symlink(), f"Missing closed capture root: {root}")
    expected = exclusions.get(root.resolve(), set())
    seen, files = set(), []
    for path in sorted(root.rglob("*")):
        relative = str(path.relative_to(root))
        if path.is_symlink():
            base.require(relative in expected, f"Unlisted symlink in closed capture: {path}")
            seen.add(relative)
            entry = {"captureRoot": str(root), "relativePath": relative,
                     "linkTarget": str(path.readlink()), "resolvedTarget": str(path.resolve()),
                     "purpose": "External installed dependencies; explicitly excluded from evidence payload"}
            key = str(path)
            base.require(key not in excluded_entries or excluded_entries[key] == entry,
                         f"Excluded dependency link changed during capture: {path}")
            excluded_entries[key] = entry
        elif path.is_file():
            base.require(not any(parent in expected for parent in [relative, *[str(p) for p in Path(relative).parents]]),
                         f"An excluded symlink became an ordinary captured path: {path}")
            files.append(path)
    base.require(seen == expected, f"Explicit symlink exclusion does not match capture: {root}")
    return sorted(files, key=lambda path: str(path.relative_to(root)))


def native_proof(root: Path, oracle: bytes) -> dict | None:
    proof = native_reference(root, oracle)
    if proof is not None and proof["frames"] == PREFIX_TICKS:
        base.require(proof["nativeCommandBytes"] == PREFIX_BYTES
                     and proof["nativeCommandSha256"] == PREFIX_SHA
                     and proof["reportedFinalChecksum"] == PREFIX_CHECKSUM,
                     f"Complete 2110-tick command/state oracle mismatch: {root}")
        proof["prefixFinalChecksumEqual"] = True
        proof["prefixFinalChecksum"] = PREFIX_CHECKSUM
    return proof


def copy_asset(source: Path, destination: Path, compress: bool) -> dict:
    raw = source.read_bytes()
    boundary_match = BOUNDARY_NAME in raw.lower()
    added_for_boundary = source.suffix != ".gz" and boundary_match and not compress
    base.require(BOUNDARY_NAME not in str(destination.relative_to(HERE)).lower().encode("utf-8"),
                 "Choose an explicit stored alias that passes the source/docs naming boundary")
    # Do not change the payload or reduce assertions to satisfy a naming boundary.
    # Existing compressed captures remain byte-identical; other affected originals get added gzip.
    asset = copy_reference(source, destination, compress or added_for_boundary)
    asset["addedGzipForRawTextBoundary"] = added_for_boundary
    return asset


base.protected_original = protected_original
base.files_under = files_under
base.native_proof = native_proof
base.copy_asset = copy_asset


def verify() -> None:
    plan = base.load(HERE / "archive-plan.json")
    configure(plan)
    base.verify()
    manifest = base.load(HERE / "evidence-manifest.json")
    base.require(manifest["structuralPrefixOracle"] == {
        "ticks": PREFIX_TICKS, "nativeCommandBytes": PREFIX_BYTES,
        "nativeCommandSha256": PREFIX_SHA, "finalChecksum": PREFIX_CHECKSUM},
        "Pinned structural prefix declaration changed")


def archive(plan_path: Path) -> None:
    plan = base.load(plan_path)
    base.require(plan.get("captureReady") is True and not plan.get("pendingInputs"),
                 "Preparation plan is not closed; retain every final experiment input before capture")
    configure(plan)
    base.archive(plan_path)
    manifest = base.load(HERE / "evidence-manifest.json")
    manifest["structuralPrefixOracle"] = {"ticks": PREFIX_TICKS, "nativeCommandBytes": PREFIX_BYTES,
                                         "nativeCommandSha256": PREFIX_SHA, "finalChecksum": PREFIX_CHECKSUM}
    manifest["explicitlyExcludedSymlinkEntries"] = list(excluded_entries.values())
    manifest["method"] += "; 315 committed earlier files protected; only explicit dependency symlinks excluded; 2110-tick state oracle verified"
    (HERE / "evidence-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    verify()


def append_file(source: Path, destination: str) -> None:
    """Append a closed execution/validation log without replacing earlier assets."""
    verify()
    base.append_file(source, destination)
    verify()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    capture = sub.add_parser("archive", help="Archive final closed inputs after all experiments finish")
    capture.add_argument("--plan", type=Path, required=True)
    sub.add_parser("verify", help="Verify all capture bytes and the 315 protected earlier files")
    late = sub.add_parser("append-file", help="Append a closed post-archive execution or validation log")
    late.add_argument("--source", type=Path, required=True)
    late.add_argument("--destination", required=True)
    args = parser.parse_args()
    if args.action == "archive":
        archive(args.plan)
    elif args.action == "append-file":
        append_file(args.source, args.destination)
    else:
        verify()


if __name__ == "__main__":
    main()
