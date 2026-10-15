"""Static checks of archived PR380 production evidence.

``analyze(raw)`` only consumes bytes returned by the caller. It does not read the
filesystem, execute evidence scripts, import application code, or use a network.
"""

import hashlib
import io
import json
from pathlib import PurePosixPath
import struct
import tarfile


ROOT = "/tmp/pr380-release-review"
MERGE = "4804631c22f7be3f83dc6374e71ce03d86068dd8"
HEAD = "0ea5beaee063c8443d66f7654333032b070d51ad"
TREE = "4e2a28c42bea617bb69a5526a35f4a3523988bc7"
FROZEN_SHA256 = "a66f8e1c033964a7d2e7f5f6a888f8fd69dcf8bc51b62643e00bf4eb1668f21b"
ARTIFACT_SHA256 = "66189832ff0b3a6a9c30a26381b368a082c7514fe9b2180d071906059ccf7bc7"
TOOL_SHA256 = "977f87d3dc24697e99166872f43a3dfa73fb017eb50961b9ce1a7e9c16345dc8"
STUB_SHA256 = "4b7c27887eaf204ea1f0324f1b13a90eb1f8fb3b4940f807cca1f5233a033b5c"
SERVED_SHA256 = "5b8fe19449089ceae78086a7cd6b5415e82dc364116922344af6845c9fe27ead"
SCENES = ("fleet", "capital", "woods")
SITE = "https://lexicalmathical.com/sketch-rts/"


def analyze(raw):
    """Assert archived facts; return JSON-serializable conclusions.

    ``raw(absolute_original_path) -> bytes`` must resolve the archived bytes at
    their original absolute paths. No current production state is queried.
    """

    def require(condition, detail):
        if not condition:
            raise AssertionError(detail)

    def digest(data):
        return hashlib.sha256(data).hexdigest()

    def safe_relative(value):
        require(isinstance(value, str) and value, "empty or non-string path")
        path = PurePosixPath(value)
        require(not path.is_absolute() and ".." not in path.parts, ("unsafe path", value))
        require("\\" not in value and path.parts and path.as_posix() == value,
                ("noncanonical path", value))
        return value

    frozen_bytes = raw(ROOT + "/FROZEN-REVIEW.json")
    require(isinstance(frozen_bytes, bytes), "raw must return bytes")
    require(len(frozen_bytes) == 43124 and digest(frozen_bytes) == FROZEN_SHA256,
            "frozen manifest bytes differ")
    frozen = json.loads(frozen_bytes)
    require(frozen["closedUtc"] == "2026-10-15T01:11:13.989797+00:00", "freeze time")
    require(frozen["fileCount"] == len(frozen["files"]) == 252, "frozen count")
    data = {"FROZEN-REVIEW.json": frozen_bytes}
    frozen_entries = {}
    for entry in frozen["files"]:
        name = safe_relative(entry["path"])
        require(name not in data and name != "FROZEN-REVIEW.json", ("duplicate frozen path", name))
        content = raw(ROOT + "/" + name)
        require(isinstance(content, bytes), ("raw must return bytes", name))
        require(len(content) == entry["bytes"], ("frozen length mismatch", name))
        require(digest(content) == entry["sha256"], ("frozen hash mismatch", name))
        frozen_entries[name] = entry
        data[name] = content
    require(sum(e["bytes"] for e in frozen["files"]) == 18721114, "frozen total bytes")
    require(sum("/" not in n for n in frozen_entries) == 141, "frozen root count")
    require(sum(n.startswith("artifact/") for n in frozen_entries) == 91, "frozen artifact count")
    require(sum(n.startswith("public-startup/") for n in frozen_entries) == 20, "frozen startup count")

    def doc(name):
        require(name in data, ("document absent from frozen set", name))
        return json.loads(data[name])

    merge_result = doc("merge-expected-head-stdout.log")
    require(merge_result["merged"] is True and merge_result["sha"] == MERGE, "merge response")
    require(doc("merge-expected-head-execution.json")["exitCode"] == 0, "merge execution")
    source = doc("merge-source-closure.json")
    require(source["measuredHead"] == HEAD and source["mergeSha"] == MERGE,
            "source closure commits")
    require(source["sameGitTree"] == TREE and source["allTreeBytesIdentical"] is True,
            "source closure tree")
    for name, sha in (("measured-head-commit-stdout.log", HEAD),
                      ("merged-main-commit-stdout.log", MERGE)):
        commit = doc(name)
        require(commit["sha"] == sha and commit["tree"]["sha"] == TREE, ("commit tree", name))

    run = doc("release-deploy-run.json")
    require(run["id"] == 38662669848 and run["head_sha"] == MERGE, "deploy run identity")
    require(run["status"] == "completed" and run["conclusion"] == "success", "deploy run status")
    require(run["head_commit"]["id"] == MERGE and run["head_commit"]["tree_id"] == TREE,
            "deploy commit tree")
    jobs = doc("release-deploy-jobs.json")
    require(jobs["total_count"] == len(jobs["jobs"]) == 1, "deploy jobs count")
    job = jobs["jobs"][0]
    require(job["id"] == 116187340616 and job["run_id"] == run["id"] and job["head_sha"] == MERGE,
            "deploy job identity")
    require(job["status"] == "completed" and job["conclusion"] == "success", "deploy job status")
    require(job["completed_at"] == "2026-10-15T01:00:36Z", "deploy completion")
    require(len(job["steps"]) == 42 and all(s["status"] == "completed" and
            s["conclusion"] == "success" for s in job["steps"]), "deploy step status")
    main = doc("release-main.json")
    tag = doc("release-tag.json")
    release = doc("release-current.json")
    require(main["ref"] == "refs/heads/main" and main["object"]["type"] == "commit" and
            main["object"]["sha"] == MERGE, "main API identity")
    require(tag["ref"] == "refs/tags/production-latest" and tag["object"]["type"] == "commit" and
            tag["object"]["sha"] == MERGE, "tag API identity")
    require(release["id"] == 413314564 and release["tag_name"] == "production-latest" and
            release["target_commitish"] == MERGE and release["draft"] is False and
            release["prerelease"] is False, "release API identity")
    require(len(release["assets"]) == 1, "release assets count")
    asset = release["assets"][0]
    require(asset["id"] == 642214724 and asset["name"] == "sketch-rts-production.tar.gz" and
            asset["state"] == "uploaded" and asset["size"] == 2467699 and
            asset["digest"] == "sha256:" + ARTIFACT_SHA256, "official asset identity")

    artifact = doc("artifact-verification.json")
    require(artifact["expectedMergeSha"] == MERGE and artifact["deployRun"] == run["id"] and
            artifact["deployJob"] == job["id"] and artifact["assetId"] == asset["id"],
            "artifact report identity")
    require(artifact["mainTagAndReleaseMatch"] is True and artifact["officialDigestMatch"] is True,
            "artifact report closure")
    archive_bytes = data[asset["name"]]
    require(artifact["artifactBytes"] == len(archive_bytes) == asset["size"] and
            artifact["artifactSha256"] == digest(archive_bytes) == ARTIFACT_SHA256,
            "artifact archive hash")
    reported = {}
    for entry in artifact["files"]:
        name = safe_relative(entry["path"])
        require(name not in reported, ("duplicate artifact manifest path", name))
        reported[name] = entry
    require(artifact["regularFiles"] == len(reported) == 91 and
            artifact["unpackedBytes"] == sum(e["bytes"] for e in reported.values()) == 11328103,
            "artifact inventory totals")
    require(set("artifact/" + n for n in reported) ==
            {n for n in frozen_entries if n.startswith("artifact/")}, "artifact frozen set")
    members_seen, tar_files, directory_count = set(), set(), 0
    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as archive:
        members = archive.getmembers()
        require(len(members) == 102, "tar member count")
        for member in members:
            name = safe_relative(member.name)
            require(name not in members_seen, ("duplicate tar path", name))
            members_seen.add(name)
            require(PurePosixPath(name).parts[0] in ("dist", "dist-server"), ("tar root", name))
            require(member.isfile() or member.isdir(), ("tar link or special file", name))
            if member.isdir():
                directory_count += 1
                continue
            require(name in reported, ("unreported tar member", name))
            content = archive.extractfile(member).read()
            entry = reported[name]
            require(len(content) == member.size == entry["bytes"] and
                    digest(content) == entry["sha256"], ("tar member metadata", name))
            require(content == data["artifact/" + name], ("tar/extracted bytes differ", name))
            tar_files.add(name)
    require(tar_files == set(reported) and directory_count == 11, "tar file set")

    manifest = doc("artifact/dist/resource-manifest.json")
    resources = {}
    for entry in manifest["assets"]:
        name = safe_relative(entry["url"])
        require(name not in resources, ("duplicate resource manifest URL", name))
        content = data["artifact/dist/" + name]
        require(entry["bytes"] == len(content) and entry["revision"] == digest(content)[:12],
                ("resource manifest metadata", name))
        resources[name] = entry
    dist = {n[len("dist/"):]: e for n, e in reported.items() if n.startswith("dist/")}
    require(len(dist) == 90 and len(resources) == 89 and
            set(resources) == set(dist) - {"resource-manifest.json"}, "resource manifest coverage")

    log_bytes = data["deploy-job-exact.log"]
    log = log_bytes.decode("utf-8")
    log_closure = doc("deploy-log-closure.json")
    payload = doc("deploy-job-connector-payload.json")
    require(payload["arguments"] == {"job_id": job["id"], "repo_full_name": "shuxueshuxue/sketch-rts"},
            "deployment log arguments")
    require(payload["result"]["isError"] is False and
            payload["result"]["structuredContent"]["content"].encode("utf-8") == log_bytes,
            "deployment log exact JSON-string roundtrip")
    require(log_closure["exactJsonStringRoundtrip"] is True and
            log_closure["utf8Bytes"] == len(log_bytes) == 334163 and
            log_closure["sha256"] == digest(log_bytes) ==
            "b3ff7426f77654ceb532ad7c8756b85c7de4d5e36ff809bf2a2117e82a4c3c5d", "deployment log hash")
    receipt = "2026-10-15T01:00:28.7525103Z deployed 4804631c***f7be3f83dc6374e71ce03d86068dd8"
    require(log_closure["deploymentReceipt"] == [receipt] and
            [line for line in log.splitlines() if " deployed " in line] == [receipt], "masked receipt")
    require(log_closure["shaIsMaskedByGitHub"] is True and
            log_closure["receiptCompatibleWithExpectedSha"] is True and
            log_closure["receiptAloneProvesFullSha"] is False, "mask limitations")
    require(MERGE.replace("22", "***") in receipt and MERGE not in receipt,
            "masked receipt compatibility")

    proof = doc("public-startup/proof.json")
    inputs = doc("public-startup/inputs.json")
    plan = doc("public-startup-plan.json")
    require(all(proof[k] == v for k, v in inputs.items()), "startup inputs differ")
    require(proof["url"] == SITE and proof["expectedMainSha"] == MERGE and
            proof["selectedScenes"] == list(SCENES) and proof["selectedSizes"] == ["desktop"] and
            proof["modes"] == ["normal"] and proof["skipUi"] is True and
            proof["fullMobile"] is False, "startup scope")
    require(proof["toolSha256"] == plan["toolSha256"] ==
            digest(data["public-startup/executed-tool.mjs"]) == TOOL_SHA256 and
            plan["expectedMain"] == MERGE, "startup tool identity")
    require(proof["expectedDist"] ==
            {n: {"bytes": e["bytes"], "sha256": e["sha256"]} for n, e in dist.items()},
            "startup expected dist differs from artifact")
    execution = doc("public-startup-execution.json")
    require(execution["exitCode"] == 1 and proof["automatedPass"] is False, "strict failure retained")
    require(execution["startedUtc"] == "2026-10-15T01:08:37.512837+00:00" and
            execution["endedUtc"] == "2026-10-15T01:10:10.710945+00:00", "startup execution window")
    checks = proof["checks"]
    require(len(checks) == 59 and all(type(c["pass"]) is bool for c in checks) and
            sum(c["pass"] for c in checks) == 56, "strict check totals")
    failed = [c for c in checks if not c["pass"]]
    require(len(failed) == 3 and {c["id"] for c in failed} ==
            {s + "-desktop-normal" for s in SCENES}, "strict failure scenes")
    require(all(c["name"] == "public-assets-entity-or-exact-cdp-representation" and
            len(c["mismatches"]) == 1 for c in failed), "strict failure kind")
    review = doc("ROOT-VISUAL-REVIEW.json")
    require(review["automatedChecks"] == {"total": 59, "passed": 56, "failed": failed,
            "originalAssertionRetained": True}, "root strict results differ")
    require(len(review["images"]) == len(proof["results"]) == 3, "startup image/result count")
    require([i["scene"] for i in review["images"]] == list(SCENES), "review image scenes")
    images, audio_differences = [], []
    stub = data["artifact/dist/audio-packs/served.json"]
    served = data["audio-config-independent.json"]
    require(len(stub) == 16 and digest(stub) == STUB_SHA256 and json.loads(stub) == {"packs": []},
            "official audio placeholder")
    require(len(served) == 41 and digest(served) == SERVED_SHA256 and
            json.loads(served) == {"packs": ["war3"], "default": "war3"}, "served audio config")
    require(doc("audio-config-independent-execution.json")["exitCode"] == 0, "independent audio GET")
    audio_command = doc("audio-config-independent-command.json")["argv"]
    require(audio_command[0] == "curl" and audio_command[-1] == SITE + "audio-packs/served.json" and
            "--insecure" not in audio_command and "-k" not in audio_command, "audio GET normal TLS")
    require(b"content-length: 41" in data["audio-config-independent.headers"].lower(), "audio headers")
    for scene, viewed, result in zip(SCENES, review["images"], proof["results"]):
        scene_id = scene + "-desktop-normal"
        scene_file = "public-startup/" + scene_id + ".json"
        require(result == doc(scene_file) and result["id"] == scene_id and
                result["scene"] == scene and result["size"] == "desktop" and
                result["mode"] == "normal", ("startup result identity", scene))
        require(result["networkFailures"] == result["console"] == result["exceptions"] == [],
                ("startup recorded errors", scene))
        require(len(result["captures"]) == 1, ("startup capture count", scene))
        capture = result["captures"][0]
        image = capture["capture"]
        image_name = "public-startup/" + scene_id + "-native-bootstrap.png"
        require(capture["phase"] == "native-bootstrap" and viewed["path"] == image_name and
                image["file"] == scene_id + "-native-bootstrap.png" and
                viewed["rootActuallyViewed"] is True, ("actual view record", scene))
        png = data[image_name]
        require(len(png) == viewed["bytes"] == image["bytes"] and
                digest(png) == viewed["sha256"] == image["sha256"], ("startup PNG hash", scene))
        require(png[:8] == b"\x89PNG\r\n\x1a\n" and png[12:16] == b"IHDR" and
                struct.unpack(">II", png[16:24]) == (1440, 900), ("startup PNG dimensions", scene))
        gpu = image["gpuCompletion"]
        require(gpu["available"] is True and gpu["status"] == 37148 and gpu["polls"] > 0,
                ("WebGL fence", scene))
        for state in (result["initial"], capture["state"], image["before"], image["after"], result["final"]):
            require(state["viewport"] == [1440, 900] and state["scene"] == scene and
                    state["gl"]["lost"] is False and "SwiftShader" in state["gl"]["renderer"] and
                    state["contextEvents"] == [], ("startup WebGL state", scene))
        failure = next(c for c in failed if c["id"] == scene_id)
        mismatch = failure["mismatches"][0]
        require(mismatch["url"] == SITE + "audio-packs/served.json" and
                mismatch["relativePath"] == "audio-packs/served.json" and
                mismatch["status"] == 200 and mismatch["mimeType"] == "application/json" and
                mismatch["type"] == "Fetch" and mismatch["fromDiskCache"] is False and
                mismatch["fromServiceWorker"] is False, ("audio mismatch identity", scene))
        require(mismatch["expected"] == {"bytes": 16, "sha256": STUB_SHA256, "match": False} and
                mismatch["body"] == {"bytes": 41, "sha256": SERVED_SHA256,
                "relativePath": "audio-packs/served.json"}, ("audio mismatch bytes", scene))
        require(result["distVerification"]["mismatches"] == failure["mismatches"] and
                result["distVerification"]["unknownStaticResponses"] == [], ("scene differences", scene))
        images.append({"scene": scene, "evidence": image_name, "bytes": len(png),
                       "sha256": digest(png), "size": [1440, 900], "rootActuallyViewed": True,
                       "gpuFenceStatus": gpu["status"]})
        audio_differences.append({"scene": scene, "evidence": scene_file,
                                  "requestId": mismatch["requestId"], "check": failure["name"],
                                  "relativePath": mismatch["relativePath"],
                                  "expected": mismatch["expected"], "body": mismatch["body"]})
    nss = doc("public-startup/nss-inventory-closure.json")
    require(nss["unchanged"] is True and nss["before"] == nss["after"] == proof["nssBefore"],
            "NSS trust inventory")
    require(frozen["startupAutomatedPass"] is False and frozen["startupChecksPassed"] == 56 and
            frozen["startupChecksTotal"] == 59 and frozen["allThreeActuallyViewed"] is True,
            "frozen startup conclusion")

    return {
        "scope": "Static verification of archived production evidence only; no new execution or network access.",
        "frozen": {"filesVerified": 252, "regularFilesIncludingManifest": 253,
                   "listedBytes": 18721114, "manifestBytes": len(frozen_bytes),
                   "manifestSha256": FROZEN_SHA256, "closedUtc": frozen["closedUtc"],
                   "excludedFromOwnList": "FROZEN-REVIEW.json"},
        "source": {"measuredHead": HEAD, "mergeSha": MERGE, "sameGitTree": TREE,
                   "allTreeBytesIdentical": True},
        "deployment": {"run": run["id"], "job": job["id"], "conclusion": "success",
                       "jobCompletedAt": job["completed_at"], "stepsSuccessful": len(job["steps"]),
                       "mainTagReleaseAndWorkflowSha": MERGE},
        "artifact": {"assetId": asset["id"], "bytes": len(archive_bytes),
                     "sha256": ARTIFACT_SHA256, "officialDigestMatch": True,
                     "tarMembers": 102, "directories": 11, "regularFiles": 91,
                     "unpackedBytes": 11328103, "allTarAndRetainedFileBytesIdentical": True,
                     "resourceManifestEntriesVerified": 89, "expectedDistFilesVerified": 90},
        "maskedLog": {"exactJsonStringRoundtrip": True, "bytes": len(log_bytes),
                      "sha256": digest(log_bytes), "deploymentReceipt": receipt,
                      "receiptCompatibleWithExpectedSha": True, "receiptAloneProvesFullSha": False,
                      "fullIdentitySources": ["release-deploy-run.json", "release-main.json",
                                              "release-tag.json", "release-current.json"]},
        "startup": {"url": SITE, "startedUtc": execution["startedUtc"],
                    "endedUtc": execution["endedUtc"], "toolSha256": TOOL_SHA256,
                    "automatedPass": False, "exitCode": 1, "checksPassed": 56, "checksTotal": 59,
                    "originalAssertionRetained": True, "images": images,
                    "audioDifferences": audio_differences, "independentAudioConfigSha256": SERVED_SHA256,
                    "existingNssTrustUnchanged": True,
                    "limits": ["Three startup images only.", "SwiftShader is not hardware FPS.",
                               "No full-game, all-animation, storyline or audible-audio proof.",
                               "The three strict audio configuration failures remain failures."]},
    }

if __name__ == '__main__':
    import base64,gzip,sys
    from pathlib import Path
    archive=Path(__file__).resolve().parent
    m=json.loads((archive/'manifest.json').read_bytes())
    records={base64.b64decode(r['originalPathBase64']).decode():r for r in m['files']}
    def archived_raw(path):
        r=records[path];b=gzip.decompress((archive/r['storedPath']).read_bytes())
        assert len(b)==r['originalBytes'] and hashlib.sha256(b).hexdigest()==r['originalSha256']
        return b
    result=analyze(archived_raw)
    if len(sys.argv)>1:Path(sys.argv[1]).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    else:assert result==json.loads((archive/'analysis.json').read_bytes())
    print(json.dumps({'complete':True,'frozenFiles':result['frozen']['filesVerified'],'artifactFiles':result['artifact']['regularFiles'],'startupPassed':result['startup']['checksPassed'],'startupTotal':result['startup']['checksTotal']}))
