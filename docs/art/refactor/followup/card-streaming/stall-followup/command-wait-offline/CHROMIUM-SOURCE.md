# Chromium source support for a token wait during texture upload

This is a static review of upstream Chromium tag **151.0.7922.173**, matching the browser version recorded for the investigation. It establishes a possible client command-buffer path, its conditions, and the limits of interpreting the existing trace. It does **not** establish that the captured long `texSubImage2D` call actually followed this path, attest the browser build configuration, or measure an optimization. No game source, trace, browser run, or test was changed for this review.

## The conditional path exists

| Step | Condition and behavior | Exact-tag primary source |
| --- | --- | --- |
| 1. Choose the ordinary upload branch | `TexSubImage2D` validates dimensions/unpack sizes. Bound pixel-unpack buffers and bound pixel-unpack transfer buffers have earlier return branches; zero-width/height also returns without the ordinary staging allocation. Otherwise, line 3460 constructs a `ScopedTransferBufferPtr` before issuing the row upload. | [gles2_implementation.cc lines 3350–3476](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/gles2_implementation.cc#3350) |
| 2. Allocate staging memory | The constructor calls `Reset(size)`; `Reset` releases any previous valid allocation, then calls `TransferBuffer::AllocUpTo`. That method may resize, selects at most `GetLargestFreeOrPendingSize()`, then calls `RingBuffer::Alloc`. A returned chunk can be smaller than the full image request. | [transfer_buffer.h lines 187–192](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/transfer_buffer.h#187), [transfer_buffer.cc lines 226–236 and 309–316](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/transfer_buffer.cc#226) |
| 3. Reclaim a pending block only when needed | `RingBuffer::Alloc` rounds the requested size to its alignment, then repeatedly frees the oldest block while contiguous free space is insufficient. `FreeOldestBlock` calls `helper_->WaitForToken(block.token)` only for a block marked `FREE_PENDING_TOKEN`. Already passed tokens can be reclaimed without a blocking IPC. | [ring_buffer.cc lines 38–88 and 159–164](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/ring_buffer.cc#38) |
| 4. Wait for command-stream progress | `CommandBufferHelper::WaitForToken` returns immediately if the token has already passed. Otherwise it calls `FlushLazy`, then `WaitForTokenInRange(requestedToken, token_)` and updates cached state. `token_` is the latest token this helper inserted, rather than the number of textures or API calls. | [cmd_buffer_helper.cc lines 254–301](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/cmd_buffer_helper.cc#254) |
| 5. Potentially make a synchronous channel request | `CommandBufferProxyImpl::WaitForTokenInRange` emits the trace event named `CommandBufferProxyImpl::WaitForToken` with `start` and `end`. After refreshing state, it makes a synchronous Mojo request only when the latest token remains outside the requested range and no context error is recorded. The IPC includes `route_id_`, but this trace event does not log that ID, a staging block, or a texture. | [command_buffer_proxy_impl.cc lines 425–455](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/ipc/client/command_buffer_proxy_impl.cc#425) |
| 6. Queue a chunk and defer its reuse | `TexSubImage2DImpl` copies rows into the allocation, queues `helper_->TexSubImage2D` with the shared-memory ID/offset, then calls `Release`. `Release` inserts a token after the upload command and marks that allocation pending on the token. If rows remain, the loop requests another chunk. `RingBuffer::FreePendingToken` records the token against the block's offset. | [gles2_implementation.cc lines 3637–3683](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/gles2_implementation.cc#3637), [transfer_buffer.cc lines 295–299](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/transfer_buffer.cc#295), [ring_buffer.cc lines 91–105](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/ring_buffer.cc#91) |

The order matters: an ordinary upload can wait **before its current pixel rows are copied into staging memory**, because reusing a block requires earlier commands to advance. A large image can also allocate multiple chunks and encounter a wait on a later chunk. This explains a legitimate mechanism by which earlier submitted work can make a later API call slow. It does not identify what made those earlier commands slow.

`TransferBuffer` can expand/shrink its ring under the conditions in lines 152–223; `AllocUpTo` does not always start with a fixed capacity or force a wait. Its shared-memory ring is distinct from the command-entry ring owned by `CommandBufferHelper`. No ring capacity, fragmentation, allocation failure, or exact staging byte count was observed in the existing trace. [TransferBuffer allocation policy](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/transfer_buffer.cc#152), [CommandBufferHelper command-entry allocation](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/cmd_buffer_helper.cc#309).

## What a token range proves, and what it does not

`InsertToken` inserts a `SetToken` command into this helper's stream and increments a 31-bit value. The common decoder's `HandleSetToken` writes that value into command-buffer service state. The token is a marker of command-stream processing; it is **not itself a GPU fence**, and these methods do not call `glFinish`. The exact backend's handling of preceding commands can still delay reaching the marker. Waiting for this marker is not a measurement of GPU completion or exclusive execution time of a texture operation. [Client token insertion](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/cmd_buffer_helper.cc#249), [common decoder token handling](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/service/common_decoder.cc#284).

The existing [offline trace findings](FINDINGS.md) record two waits inside cycle 1 n135's 43rd observed `texSubImage2D`: `start=5898,end=5939`, then `start=5899,end=5939`. They are **compatible with** an allocation reclaiming successive pending blocks while the helper's latest token remains unchanged. This is an inference from the source and timing, not a recovered call stack. The difference of 41 in the first range is not a count of uploads, mip levels, GPU commands, or scratch layers. One upload can insert multiple chunk tokens; unrelated APIs can allocate from the same staging mechanism or insert tokens into the same helper stream. Different helpers/routes can also have overlapping token numbers.

The source has the information required to map an actual pending block to a token: block offset/size/state/token, transfer-buffer shared-memory ID, helper/route identity, and command sequence. The retained trace does not capture those links. Its trace event logs only the range. The JavaScript GL observer's texture IDs and API ordinals are a different identity domain from Chromium's shared-memory allocations and service command stream. Matching timestamps and ordinal 43 cannot bridge that missing identity mapping.

To prove the reclaim path for this call, a Chromium-instrumented run or equivalent native stack capture would need to record the actual caller of `WaitForToken`, the context/route/helper, selected pending block and allocation request, shared-memory ID/offset, and token insertion attached to decoded upload commands. To assign the underlying delay to native mip generation, array copies, driver work, software-renderer workers, or scheduling would additionally require those work intervals and their resource/order links. Browser-level fence/query brackets can test where waiting moves; they cannot recreate the missing token-to-block mapping. No claim is made that a generic trace-category switch alone exposes all these fields.

## Other waits prevent identification from the event name alone

This source review is intentionally not an exhaustive browser call-graph audit. It already finds other paths that rule out treating the trace event's name as a unique staging-reclamation signature:

- `GetQueryObjectValueHelper` calls the same helper `WaitForToken(query->token())` when `GL_QUERY_RESULT_EXT` is requested before a result is available; it can subsequently call `FinishHelper`. The availability-check branches have different behavior. [gles2_implementation.cc lines 1447–1468](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/gles2_implementation.cc#1447).
- `MapBufferCHROMIUM` waits on a pixel-pack transfer buffer's prior usage token before exposing its memory. This also reaches the helper token wait. [gles2_implementation.cc lines 6433–6466](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/gles2_implementation.cc#6433).
- Many APIs use `ScopedTransferBufferPtr` or `TransferBuffer::Alloc`, so staging reclamation itself is shared beyond `TexSubImage2D`. For example, `GetAttachedShaders` allocates from `transfer_buffer_`, inserts a token and later frees the result pending on that token. [gles2_implementation.cc lines 4136–4179](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/gles2_implementation.cc#4136).
- A full command-entry ring can wait through `WaitForGetOffsetInRange`; the proxy emits the distinct event `CommandBufferProxyImpl::WaitForGetOffset`. `CommandBufferHelper::Finish` also waits for get-offset progress. These are additional synchronous queue waits, not the named token event. [cmd_buffer_helper.cc lines 233–246 and 309–359](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/cmd_buffer_helper.cc#233), [proxy get-offset wait lines 458–491](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/ipc/client/command_buffer_proxy_impl.cc#458).

`TexSubImage2D` also calls `CheckGLError` at branch exits. The downloaded implementation defines its checking body conditionally under `GL_CLIENT_FAIL_GL_ERRORS`; `GetGLError` can use `WaitForCmd`. This review does not establish that macro's setting in the actual browser or audit all error-check implementations. It does not count that conditional path as the explanation for the captured token event. [gles2_implementation.cc lines 747–781](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/gpu/command_buffer/client/gles2_implementation.cc#747).

## Exact source archive and verification

[manifest.json](chromium-source/manifest.json) records upstream/fetch URLs, HTTP status, decoded bytes/SHA-256, compressed bytes/SHA-256, and line count for each file. The archives contain the **entire original base64-decoded upstream files**, with no edits to copyright headers or license text. Each is independently gzip-compressed with timestamp 0, and all eight source files plus five original fetch metadata records round-trip exactly. The original incorrect client-directory proxy request's HTTP 404 remains in archived metadata; the corrected `gpu/ipc/client/` request succeeded with HTTP 200.

| Upstream file | Decoded bytes | Decoded SHA-256 |
| --- | ---: | --- |
| `gpu/ipc/client/command_buffer_proxy_impl.cc` | 33,782 | `02ff8e765e1202616970a7e68d1fb5874a4f2aa71048288cd59a28fe16dcebcf` |
| `gpu/command_buffer/client/transfer_buffer.cc` | 11,011 | `b75bd6677464ce7388d4af321140b3acec1a19c77daf4a232e014d50f645b81d` |
| `gpu/command_buffer/client/ring_buffer.cc` | 6,401 | `deaf072c337177cedf8123d879ebcd86717ab96f5b64f8f4204c76a88d5cc94a` |
| `gpu/command_buffer/client/cmd_buffer_helper.cc` | 13,772 | `a2dfae2845fbaed16705a5d5b6951f724d467911ab6417854adceb145ebb0a98` |
| `gpu/command_buffer/client/gles2_implementation.cc` | 258,877 | `c7a47a5d7f773a7b262237593d6b8b6085a52558cf09987599cb6e5e606aeeaf` |
| `gpu/command_buffer/client/transfer_buffer.h` | 9,868 | `cdc05b24ffcdc5e036ca43e628ab7bcabc6c8ba98c1fbfc71cd38e10f1b561f2` |
| `gpu/command_buffer/service/common_decoder.cc` | 14,613 | `dc7c85dd6b0ad9f38e82046ee3f2dc3371ab38491f3232a89e46515a5d0c6067` |
| `LICENSE` | 1,536 | `368cca1106be99d39ecd32a38d8305585d802a475effb66380b91ffc9bcf709b` |

The source files total 349,860 decoded bytes / 64,514 gzip bytes. These are archive sizes, not browser memory measurements. [The exact-tag Chromium BSD-style license](https://chromium.googlesource.com/chromium/src/+/refs/tags/151.0.7922.173/LICENSE) is retained as [LICENSE.gz](chromium-source/LICENSE.gz).

From the repository root, verify both compressed and decoded identities using only the small archive:

```bash
python - <<'PY'
import gzip, hashlib, json
from pathlib import Path
root = Path('docs/art/refactor/followup/card-streaming/stall-followup/command-wait-offline/chromium-source')
manifest = json.loads((root / 'manifest.json').read_text())
for item in manifest['sources'] + manifest['fetchMetadata']:
    packed = (root / item['archive']).read_bytes()
    data = gzip.decompress(packed)
    assert len(packed) == item['gzipBytes']
    assert hashlib.sha256(packed).hexdigest() == item['gzipSha256']
    assert len(data) == item['decodedBytes']
    assert hashlib.sha256(data).hexdigest() == item['decodedSha256']
print('Verified 8 source files and 5 original fetch records')
PY
```

This review supports staging reuse as a concrete candidate to test. The captured wait still has no proven token-to-allocation mapping, and the current software-rendering environment does not establish behavior on a hardware GPU.
