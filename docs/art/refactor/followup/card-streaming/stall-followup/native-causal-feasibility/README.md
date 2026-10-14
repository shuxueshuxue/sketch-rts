# Native causal forensics: feasibility and concrete prerequisites

This read-only inspection **does not recover the actual caller or token-to-allocation/decoder identity chain**. No prior drain, stage, depth-one scratch or game workload was rerun. No browser build, package installation, system permission change, sandbox disabling, Chromium private-memory inspection or hardware-device request occurred. All previously validated production source/art remains unchanged; PR346 remains draft.

## Actual installed binaries and debug data

The installed package is `chromium 151.0.7922.173-1~deb13u1`. ELF files, complete SHA-256, section/export tables and exact commands are recorded in [environment.json](environment-v1/environment.json). The primary binary is `/usr/lib/chromium/chromium`; `/usr/bin/chromium` is its shell launcher.

| Module | Actual ELF Build ID | Expected matching debug-file location | Found locally |
| --- | --- | --- | --- |
| chromium | `73255ebb863e89705adfd9f96d605f6470c41f6e` | `/usr/lib/debug/.build-id/73/255ebb863e89705adfd9f96d605f6470c41f6e.debug` | no |
| libEGL.so | `6e271506994c1a98093d6ac7875ad34ee7ddbe05` | `/usr/lib/debug/.build-id/6e/271506994c1a98093d6ac7875ad34ee7ddbe05.debug` | no |
| libGLESv2.so | `4375c1d2ccd8794228ea1c3d52017797c80bd315` | `/usr/lib/debug/.build-id/43/75c1d2ccd8794228ea1c3d52017797c80bd315.debug` | no |

These modules have no `.symtab` or embedded DWARF debug sections. The Chromium dynamic exports do not contain `WaitForToken`, `RingBuffer`, `TransferBuffer`, `GLES2Implementation` or `HandleSetToken`. Chromium has `.eh_frame`, but unwind tables alone do not establish readable function/type/local-variable information or prove that a sampled native stack can be captured. Standard debug locations, including the empty `/usr/lib/debug` tree, were inspected. No statement is made about symbols on an external server or another environment.

The exact upstream tag previously reviewed matches the browser version, **not necessarily the distribution patches, compile flags or optimized object layout** of this ELF. A generic same-version source tree or unrelated debug file is not a replacement for matching Build-ID symbols and useful type/variable information.

## Permissions are not simply “blocked by sandbox”

The bounded [own-task probes](environment-v1/environment.json) establish:

- A disabled, user-only software CPU-clock `perf_event_open` descriptor for pid0 succeeds and is immediately closed. It samples nothing and excludes kernel/hypervisor work. This does not establish call-chain sampling, Chrome attachment, native symbolization or GPU sampling.
- Installed `strace 6.13` successfully traces only a newly spawned `/usr/bin/true` child ([log](environment-v1/own-child-strace.log)). Its build advertises libunwind stack-trace support. This is not a native Chromium stack capture or permission proof for renderer/GPU processes. Ordinary strace can inspect syscall registers/argument strings in that own true child; the recorded audit scope wording about memory is limited to no Chromium or unrelated-process private-object inspection, not a denial of this ordinary syscall decoding.
- `perf`, `gdb`, `lldb`, `bpftrace` and `trace-cmd` executables are absent. `readelf`, `nm`, `objdump` and `addr2line` are present. `/sys/kernel/tracing` and `/sys/kernel/debug/tracing` are absent; no mount or BPF attachment is attempted.
- The process reports `perf_event_paranoid=2`, zero effective capabilities, `NoNewPrivs=1` and seccomp mode2. The successful probes prevent using these settings as a blanket denial of user-space tracing. A live Chrome attach would need its own permitted, narrowly scoped check; it was not attempted.

## Ordinary stock-browser startup result

A new private `about:blank` profile was launched with headless/remote-debugging settings only. The [actual v2 proof](stock-browser-v2/proof.json) and [stderr](stock-browser-v2/browser-stderr.log) record **SIGABRT before DevTools startup**. Chromium reports that its SUID sandbox helper is not configured correctly and requires root ownership/mode4755. Read-only stat shows the visible helper owner is **uid65534** while its mode is already **4755**. The environment's user namespace mapping is retained in [namespace/cleanup observation](namespace-and-cleanup.json); no ownership or mode is changed. The same stderr also contains Crashpad mkdir/database errors. The terminal fatal diagnostic is the SUID check; repairing it alone is not claimed to make every other launch condition work.

The attempt did not add `--no-sandbox`, `--disable-setuid-sandbox` or alternative sandbox-bypass flags and did not retry with them. Earlier performance experiments used their separately recorded launch configuration; this audit does not erase those successful runs or claim that all possible launch configurations are unusable. It also does not infer a graphics cause from this ordinary-startup failure.

Because startup did not expose DevTools, actual `Tracing.getCategories`, the live CDP protocol and native sampling output were **not obtained**. Existing trace scripts enabled eight ordinary timeline/V8/GC/Skia/GPU categories with no configured native-stack sampler. Category names in source or a successful generic trace response would not prove native frames or private-state availability.

The first capability wrapper exited13 because teardown awaited an already-signaled child without a live timer. Its [exact executed script](stock-browser-v1/executed-capability.mjs), [actual failure log](stock-browser-v1.log.gz) and [missing-proof record](stock-browser-v1/failed-wrapper.json) remain unchanged. V2 fixes only wrapper teardown and records the actual startup failure. Its failure stack is the Node wrapper stack, not a Chromium native caller stack. V1 has no reconstructed browser stderr or fabricated proof. The two empty owned temporary profile directories were cleaned explicitly; no existing browser/application data was removed.

## What current evidence logs, and what it does not

The [exact-tag Chromium source audit](../command-wait-offline/CHROMIUM-SOURCE.md) and original trace remain intact. The following is a bounded review of the retained source files, not an exhaustive audit of every Chromium category or distribution patch:

| Site in retained upstream source | Existing event fields | Missing causal link |
| --- | --- | --- |
| `ring_buffer.cc:38–105` | no relevant trace event | allocation request and selected pending block offset/size/state/token |
| `transfer_buffer.cc:226–236,295–316` | `Free` with no arguments | ring/shared-memory identity, allocation and release token |
| `cmd_buffer_helper.cc:254–301` | no ordinary token insertion/wait event; token-wrap event only | helper identity and token's command position |
| `command_buffer_proxy_impl.cc:392–445` | flush put-offset; wait start/end range | actual caller, channel/route/helper identity and synchronous IPC branch |
| `common_decoder.cc:284–289` | no relevant SetToken event | same-route decoded command sequence and token update |

Channel/stub/generated GLES decoder paths not present in the retained source archive remain a coverage gap. Extra stock categories have not been exhaustively ruled out. However, the retained `WaitForToken` range, GPU task dispatch location, JS texture/API ordinal and CDP target/process IDs do **not** bridge the missing block/helper/shmem identity domains. They cannot prove that the historical wait used staging reclamation rather than query/map or another caller.

## What is needed to continue

A concrete next attempt needs either of the following observation paths, supplied in an environment/configuration already authorized for native diagnostics:

1. **Matching native debug/type data plus an available debugger/sampler**, a usable permitted browser launch, and a scoped permission check for its own renderer/GPU children. First recover the actual `WaitForToken` caller stack. Then use useful object layouts/locals to record helper/proxy and stable channel/route identities, requested/aligned allocation, selected pending block, ring/shared-memory ID/generation/offset, upload chunk command and inserted token, and the corresponding service decoder/SetToken sequence. Stripped addresses or symbols without recoverable object information may still be insufficient.
2. **A source-attested instrumented Chromium build** that emits those identities and caller/command positions on both client and service sides. This requires a new build/artifact; none was built or fetched here. It must retain the original browser work and record already-computed fields. Instrumentation must not call `GetShmId()` just to log it: the retained implementation performs reallocation checks there. Free-space/token getters can also refresh/reclaim state. Logging cannot introduce such extra operations and then call the path unchanged.

Either path can investigate the native chain under software rendering. It must not treat a SetToken marker as GPU completion, generic task duration as exclusive mip cost, or a newly observed reproduction as retroactive proof of the historical 255–275 ms invocation.

**Hardware graphics validation is a separate unfinished item.** `/dev/dri` is absent, and no new hardware result is claimed. A hardware environment is needed to generalize the performance/quality comparison to an actual GPU; it is not the reason this native CPU caller/identity chain lacks symbols and recorded fields.

## Reproduce only these capability checks

```sh
python3 scripts/art-native-environment-audit.py --out work/native-capability-recheck/environment
node scripts/art-native-causal-feasibility.mjs --out work/native-capability-recheck/browser
```

Outputs must be fresh. The first command reads installed files/settings, opens and closes one disabled own-task counter, and straces a newly spawned true child. The second tries only an ordinary private about:blank browser, records failure or available read-only CDP capabilities, and performs no game/trace workload or sandbox fallback. The executed scripts are saved in each output with full SHA. No install or privilege adjustment is included.

Six raw stdout/failure-log files contain original tool whitespace; [their archive map](stdout-archives.json) preserves exact original bytes as gzip. `artifact-manifest.json` and executed environment metadata retain their original decoded filenames/SHA. Restore those filenames before applying a checker that expects them; no raw output was trimmed. From this report directory:

```sh
python3 - <<'PY'
import gzip, hashlib, json
from pathlib import Path
for row in json.loads(Path('stdout-archives.json').read_text())['files']:
    data = gzip.decompress(Path(row['archive']).read_bytes())
    assert len(data) == row['bytes'] and hashlib.sha256(data).hexdigest() == row['sha256']
    Path(row['originalPath']).write_bytes(data)
PY
```

The initial artifact manifest records the human report before stdout packaging. Its exact prior bytes remain in [the captured report archive](captured-report-before-stdout-packaging.md.gz); current published file identities are listed separately in [the packaging manifest](packaging-manifest.json). No captured environment/probe result was rewritten.
