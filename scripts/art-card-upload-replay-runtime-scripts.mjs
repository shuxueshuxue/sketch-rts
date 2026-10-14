/** Capture the browser's decoded HTTP Script responses, not raw TS snapshots.
 * The caller must forward events from the same attached CDP session as `page`.
 * Call start before navigation and finish after all replay work has stopped.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function createRuntimeScriptCollector({ page, outputDir, sourceRoot, harnessRoot, hash }) {
  if (typeof page !== 'function' || typeof hash !== 'function') throw new TypeError('Runtime script collector requires page and hash functions');
  const slash = value => String(value).replaceAll('\\', '/');
  const sourcePrefix = slash(resolve(sourceRoot));
  const harnessPrefix = slash(resolve(harnessRoot));
  const directory = resolve(outputDir, 'runtime-http-scripts');
  const records = new Map(), completed = new Map(), failed = new Map(), pending = new Set(), bodyWrites = new Map();
  let state = 'new', serial = 0, finishPromise;
  const documentOrigins = new Set();
  const metadata = {
    version: 1,
    evidence: 'Decoded response bodies returned by CDP Network.getResponseBody for actual Script responses. UTF-8 re-encoding of CDP text is explicitly distinguished from base64 decoding. These are HTTP-transformed JS response bytes; raw TS inventory hashes are separate provenance, not executed JS evidence.',
    executionLimit: 'A Script network response proves the response body was delivered, not that every statement executed. No Debugger source or execution coverage is claimed.',
    callerMustFilterAttachedSession: true,
    enableOptions: { maxTotalBufferSize: 256 * 1024 * 1024, maxResourceBufferSize: 64 * 1024 * 1024, enableDurableMessages: true },
    sourceRoot: sourcePrefix, harnessRoot: harnessPrefix,
    scripts: [], redirects: [], coverageGaps: [], inventoryCoverage: [],
    started: false, finished: false, passed: false,
  };
  const gap = (reason, details = {}) => metadata.coverageGaps.push({ reason, ...details });
  const writeMetadata = () => writeFile(resolve(outputDir, 'runtime-http-scripts.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
  function ensure(requestId) {
    if (!records.has(requestId)) {
      const row = { requestId, sequence: ++serial, request: null, response: null, body: null, bodyError: null };
      records.set(requestId, row); metadata.scripts.push(row);
    }
    return records.get(requestId);
  }
  function retainBody(row) {
    if (!row.response || !row.loadingFinished || row.bodyRequested) return;
    row.bodyRequested = true;
    const operation = (async () => {
      try {
        const result = await page('Network.getResponseBody', { requestId: row.requestId });
        if (typeof result?.body !== 'string' || typeof result.base64Encoded !== 'boolean') throw new Error('CDP returned no valid response body');
        const bytes = Buffer.from(result.body, result.base64Encoded ? 'base64' : 'utf8');
        const sha256 = hash(bytes), filename = `${sha256}.js`;
        if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('hash must return a hexadecimal SHA-256');
        if (!bodyWrites.has(sha256)) bodyWrites.set(sha256, (async () => {
          try { await writeFile(resolve(directory, filename), bytes, { flag: 'wx' }); }
          catch (error) {
            if (error.code !== 'EEXIST') throw error;
            if (!bytes.equals(await readFile(resolve(directory, filename)))) throw new Error('Existing SHA body file differs');
          }
        })());
        await bodyWrites.get(sha256);
        row.body = {
          file: `runtime-http-scripts/${filename}`, sha256, bytes: bytes.length,
          base64Encoded: result.base64Encoded,
          decoding: result.base64Encoded ? 'base64-decoded-CDP-body' : 'UTF-8-encoded-CDP-text',
          networkEncodedDataLength: row.loadingFinished.encodedDataLength,
          capturedBy: 'Network.getResponseBody',
        };
      } catch (error) {
        row.bodyError = { message: String(error), stack: error.stack ?? null };
        gap('Script response body unavailable, evicted, or could not be archived', { requestId: row.requestId, url: row.response.url, error: String(error) });
      }
    })();
    pending.add(operation);
    operation.finally(() => pending.delete(operation));
  }
  function handleEvent(message) {
    if (!['starting', 'collecting', 'finishing'].includes(state)) return;
    const p = message?.params;
    if (!p?.requestId) return;
    if (message.method === 'Network.requestWillBeSent') {
      if (p.type !== 'Script' && !records.has(p.requestId)) return;
      const row = ensure(p.requestId);
      if (p.redirectResponse) metadata.redirects.push({ requestId: p.requestId, from: row.request?.url ?? p.redirectResponse.url, to: p.request.url, response: p.redirectResponse });
      row.request = { url: p.request.url, documentURL: p.documentURL ?? null, method: p.request.method, headers: p.request.headers, timestamp: p.timestamp, wallTime: p.wallTime, frameId: p.frameId ?? null, loaderId: p.loaderId ?? null };
      if (/^https?:\/\//.test(p.documentURL ?? '')) documentOrigins.add(new URL(p.documentURL).origin);
    } else if (message.method === 'Network.responseReceived') {
      if (p.type !== 'Script' && !records.has(p.requestId)) return;
      const row = ensure(p.requestId), r = p.response;
      row.response = {
        url: r.url, status: r.status, statusText: r.statusText, headers: r.headers,
        mimeType: r.mimeType, protocol: r.protocol, charset: r.charset ?? null,
        fromDiskCache: r.fromDiskCache ?? false, fromServiceWorker: r.fromServiceWorker ?? false,
        fromPrefetchCache: r.fromPrefetchCache ?? false, encodedDataLengthAtResponse: r.encodedDataLength,
        timestamp: p.timestamp, hasExtraInfo: p.hasExtraInfo ?? null,
      };
      if (!/^https?:\/\//.test(r.url)) gap('Script response is outside the HTTP response-body proof scope', { requestId: p.requestId, url: r.url });
      if (r.status >= 400 || r.status < 200 || r.status >= 300 && r.status !== 304) gap('Script response has an unsuccessful HTTP status', { requestId: p.requestId, url: r.url, status: r.status });
      if (completed.has(p.requestId)) row.loadingFinished = completed.get(p.requestId);
      if (failed.has(p.requestId)) row.loadingFailed = failed.get(p.requestId);
      retainBody(row);
    } else if (message.method === 'Network.loadingFinished') {
      const finished = { timestamp: p.timestamp, encodedDataLength: p.encodedDataLength };
      completed.set(p.requestId, finished);
      const row = records.get(p.requestId);
      if (row) { row.loadingFinished = finished; retainBody(row); }
    } else if (message.method === 'Network.loadingFailed') {
      const failure = { timestamp: p.timestamp, errorText: p.errorText, canceled: p.canceled ?? false, blockedReason: p.blockedReason ?? null, corsErrorStatus: p.corsErrorStatus ?? null };
      failed.set(p.requestId, failure);
      if (p.type === 'Script' || records.has(p.requestId)) {
        const row = ensure(p.requestId); row.loadingFailed = failure;
        gap('Script request failed', { requestId: p.requestId, url: row.response?.url ?? row.request?.url ?? null, ...failure });
      }
    }
  }
  function onEvent(message) {
    try { handleEvent(message); }
    catch (error) { gap('Could not process a CDP Network event', { method: message?.method ?? null, requestId: message?.params?.requestId ?? null, error: String(error) }); }
  }
  // Retain complete response URLs in evidence. Only the Vite timestamp cache
  // buster is ignored for inventory matching; semantic queries stay distinct.
  function identity(identifier, fallbackQuery = '') {
    if (!identifier || typeof identifier !== 'string') return null;
    const value = slash(identifier), withoutFragment = value.split('#')[0];
    let path, query;
    if (/^https?:\/\//.test(value)) {
      const parsed = new URL(value); path = parsed.pathname; query = parsed.search.slice(1);
    } else {
      const index = withoutFragment.indexOf('?');
      path = index < 0 ? withoutFragment : withoutFragment.slice(0, index);
      query = index < 0 ? fallbackQuery : withoutFragment.slice(index + 1);
    }
    try { path = decodeURIComponent(path); } catch { return null; }
    if (path.startsWith('/@fs/')) path = path.slice('/@fs'.length);
    else if (path.startsWith('/src/')) path = `${sourcePrefix}${path}`;
    else if (path.startsWith('src/')) path = `${sourcePrefix}/${path}`;
    else if (path.startsWith('/scripts/')) path = `${harnessPrefix}${path}`;
    const params = new URLSearchParams(query); params.delete('t'); params.sort();
    return { path, query: params.toString(), key: `${path}?${params.toString()}` };
  }
  function inventoryCoverage(inventory) {
    if (!inventory || !Array.isArray(inventory.loadedModules) || !Array.isArray(inventory.moduleGraph)) {
      gap('Source inventory must contain final loadedModules and moduleGraph arrays'); return;
    }
    const helpers = new Set((inventory.helperSnapshots ?? []).map(row => identity(row.path)?.path).filter(Boolean));
    for (const row of inventory.loadedModules) {
      const path = identity(row.path ?? row.id)?.path;
      if (path && /helper|diagnostic|fixture|provider/.test(row.kind ?? '')) helpers.add(path);
    }
    const graph = inventory.moduleGraph;
    metadata.documentOrigins = [...documentOrigins];
    if (documentOrigins.size !== 1) gap('Cannot map relative source graph URLs to a single observed HTTP document origin', { documentOrigins: metadata.documentOrigins });
    const documentOrigin = documentOrigins.size === 1 ? [...documentOrigins][0] : null;
    const isRelevant = row => {
      const identities = [row.path, row.id, row.url].map(value => identity(value)).filter(Boolean);
      return row.kind === 'production-source' || identities.some(value => value.path.startsWith(`${sourcePrefix}/src/`) || value.path.startsWith(`${harnessPrefix}/scripts/`) || helpers.has(value.path));
    };
    const responses = new Map();
    for (const row of metadata.scripts) {
      if (!row.body || !row.response) continue;
      // An unrelated origin's /src/foo.ts must not satisfy this server's graph.
      if (!documentOrigin || !/^https?:\/\//.test(row.response.url) || new URL(row.response.url).origin !== documentOrigin) continue;
      const key = identity(row.response.url)?.key;
      if (!key) continue;
      if (!responses.has(key)) responses.set(key, []);
      responses.get(key).push({ requestId: row.requestId, url: row.response.url, status: row.response.status, ...row.body });
    }
    function mapRow(row, collection, index) {
      if (!isRelevant(row)) return;
      const main = identity(row.id ?? row.url ?? row.path), aliases = new Set();
      for (const value of [row.id, row.url, row.path]) {
        const alias = identity(value, main?.query ?? ''); if (alias) aliases.add(alias.key);
      }
      if (collection === 'loadedModules') for (const node of graph) {
        // The final Vite graph supplies HTTP route aliases for scratch helpers
        // and /@fs modules. Match module IDs including semantic query first.
        if (identity(node.id)?.key !== main?.key) continue;
        const alias = identity(node.url, main?.query ?? ''); if (alias) aliases.add(alias.key);
      }
      const matches = [...aliases].flatMap(key => responses.get(key) ?? []);
      const unique = [...new Map(matches.map(value => [value.requestId, value])).values()];
      const mapped = { collection, index, id: row.id ?? null, path: row.path ?? null, url: row.url ?? null, kind: row.kind ?? null, rawInventorySha256: row.sha256 ?? null, matchingKeys: [...aliases], responses: unique };
      metadata.inventoryCoverage.push(mapped);
      if (!unique.length) gap('Loaded production/helper module has no captured HTTP transformed JS response body', { collection, index, id: mapped.id, path: mapped.path, url: mapped.url, matchingKeys: mapped.matchingKeys });
    }
    inventory.loadedModules.forEach((row, index) => mapRow(row, 'loadedModules', index));
    graph.forEach((row, index) => mapRow(row, 'moduleGraph', index));
    metadata.coverageSummary = {
      loadedModules: inventory.loadedModules.length, graphModules: graph.length,
      relevantInventoryEntries: metadata.inventoryCoverage.length,
      coveredInventoryEntries: metadata.inventoryCoverage.filter(row => row.responses.length).length,
      scriptResponses: metadata.scripts.filter(row => row.response).length,
      capturedScriptBodies: metadata.scripts.filter(row => row.body).length,
      uniqueBodySha256: [...new Set(metadata.scripts.filter(row => row.body).map(row => row.body.sha256))],
      timestampQueryIgnoredForMatchingOnly: 't',
      semanticQueriesPreserved: true,
      inventoryResponseOrigin: documentOrigin,
    };
    if (!metadata.inventoryCoverage.some(row => row.kind === 'production-source' || [row.path, row.id, row.url].some(value => identity(value)?.path.startsWith(`${sourcePrefix}/src/`)))) gap('No production source modules were found in runtime coverage inventory');
  }
  async function start() {
    if (state !== 'new') throw new Error('Runtime script collector may start only once');
    state = 'starting'; await mkdir(directory, { recursive: true });
    try {
      await page('Network.enable', metadata.enableOptions);
      metadata.started = true; state = 'collecting';
    } catch (error) {
      gap('Network.enable failed before navigation', { error: String(error) });
      state = 'failed'; await writeMetadata(); throw error;
    }
  }
  function finish(sourceInventory) {
    if (finishPromise) return finishPromise;
    finishPromise = (async () => {
      if (state !== 'collecting') throw new Error(`Runtime script collector cannot finish in state ${state}`);
      state = 'finishing';
      while (pending.size) await Promise.all([...pending]);
      for (const row of metadata.scripts) {
        if (!row.response) gap('Script request has no response event', { requestId: row.requestId, url: row.request?.url ?? null });
        if (!row.loadingFinished && !row.loadingFailed) gap('Script request has no loadingFinished event at collection boundary', { requestId: row.requestId, url: row.response?.url ?? row.request?.url ?? null });
        if (row.response && !row.body && !row.bodyError) gap('Script response has no archived body at collection boundary', { requestId: row.requestId, url: row.response.url });
      }
      try { inventoryCoverage(sourceInventory); }
      catch (error) { gap('Source inventory coverage mapping failed', { error: String(error), stack: error.stack ?? null }); }
      metadata.finished = true; metadata.passed = metadata.coverageGaps.length === 0;
      state = 'finished'; await writeMetadata();
      if (!metadata.passed) {
        const error = new Error(`Runtime HTTP Script coverage failed with ${metadata.coverageGaps.length} gap(s); see runtime-http-scripts.json`);
        error.runtimeScriptMetadata = metadata; throw error;
      }
      return metadata;
    })();
    return finishPromise;
  }
  return { onEvent, start, finish };
}
