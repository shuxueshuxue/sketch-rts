import { setScratchCanvasFactory } from "../art/scratch-canvas";
import { paintTerrainChunk } from "../terrain-art";
import type { Terrain } from "../../shared/terrain";
import type { TerrainChunkReply, TerrainChunkRequest } from "./protocol";

// The Web Worker terrain chunks are painted on (see @@@terrain-chunk-thread): offscreen canvases, sent back as bitmaps.
setScratchCanvasFactory((width, height) => new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement);
const scope = globalThis as unknown as { postMessage(reply: TerrainChunkReply, transfer: Transferable[]): void; onmessage: ((event: { data: TerrainChunkRequest }) => void) | null };
let terrain: Terrain | undefined;
scope.onmessage = ({ data }) => {
  if (data.terrain) terrain = data.terrain;
  try {
    const chunk = paintTerrainChunk(terrain!, data.cx, data.cy, data.density);
    const ground = bitmap(chunk.ground), water = chunk.water && bitmap(chunk.water);
    scope.postMessage({ request: data.request, ground, ...(water ? { water } : {}) }, water ? [ground, water] : [ground]);
  } catch (error) {
    scope.postMessage({ request: data.request, error: String(error) }, []);
  }
};

function bitmap(picture: HTMLCanvasElement | ImageBitmap) {
  return (picture as unknown as OffscreenCanvas).transferToImageBitmap();
}
