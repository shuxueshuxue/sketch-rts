import type { Terrain } from "../../shared/terrain";
import type { PaintedTerrainChunk, TerrainChunkPainter } from "../terrain-art";
import type { TerrainChunkReply, TerrainChunkRequest } from "./protocol";

/** A chunk painter on its own Web Worker (see @@@terrain-chunk-thread), or none where the browser cannot paint off the page. */
export function createTerrainChunkPainter(): TerrainChunkPainter | undefined {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return undefined;
  const thread = new Worker(new URL("./entry.ts", import.meta.url), { type: "module" });
  const waiting = new Map<number, { resolve(chunk: PaintedTerrainChunk): void; reject(error: Error): void }>();
  let next = 0, sent: Terrain | undefined, failure: Error | undefined;
  thread.onmessage = ({ data }: MessageEvent<TerrainChunkReply>) => {
    const waiter = waiting.get(data.request);
    waiting.delete(data.request);
    if ("error" in data) waiter?.reject(new Error(data.error));
    else waiter?.resolve({ ground: data.ground, ...(data.water ? { water: data.water } : {}) });
  };
  thread.onerror = (event) => {
    event.preventDefault();
    failure = new Error(event.message || "terrain chunk thread failed");
    for (const waiter of waiting.values()) waiter.reject(failure);
    waiting.clear();
    thread.terminate();
  };
  return (terrain, cx, cy, density) => new Promise((resolve, reject) => {
    if (failure) return reject(failure);
    const request = next++;
    waiting.set(request, { resolve, reject });
    const message: TerrainChunkRequest = { request, cx, cy, density, ...(terrain === sent ? {} : { terrain }) };
    thread.postMessage(message);
    sent = terrain;
  });
}
