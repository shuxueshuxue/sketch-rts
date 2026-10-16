import type { Terrain } from "../../shared/terrain";

// The page asks the chunk painter thread for one chunk (see @@@terrain-chunk-thread). The terrain rides along when it is
// not the one the last request named, so the thread keeps one terrain and the pictures it derives from it.
export type TerrainChunkRequest = { request: number; terrain?: Terrain; cx: number; cy: number; density: number };

export type TerrainChunkReply =
  | { request: number; ground: ImageBitmap; water?: ImageBitmap }
  | { request: number; error: string };
