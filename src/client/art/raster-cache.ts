import { createScratchCanvas } from './scratch-canvas';

type Raster = { canvas: HTMLCanvasElement; x: number; y: number; density: number };

/** Keep the authored resolution and anchor, but retain only painted pixels.
 * A shared work surface avoids allocating a large temporary canvas for every
 * animation key. Transparent padding is not part of the retained budget. */
export class RasterCache {
  private entries = new Map<string, Raster>();
  private scratch: HTMLCanvasElement | undefined;
  private pixels = 0;
  private painting = false;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  constructor(private budget = 12 * 1024 * 1024, private limit = 1024) {}

  get(key: string, density: number, paint: (brush: CanvasRenderingContext2D) => void): Raster {
    const id = `${key}:${density}`;
    const cached = this.entries.get(id);
    if (cached) {
      this.hits++;
      this.entries.delete(id); this.entries.set(id, cached);
      return cached;
    }
    this.misses++;
    const size = 128 * density;
    const nested = this.painting;
    const source = nested ? createScratchCanvas(size, size) : this.scratch ??= createScratchCanvas(size, size);
    // Reset state as well as pixels: callers may change clips and transforms.
    source.width = source.height = size;
    const brush = source.getContext('2d')!;
    brush.scale(density, density); brush.translate(64, 64);
    brush.lineJoin = brush.lineCap = 'round';
    this.painting = true;
    try { paint(brush); } finally { this.painting = nested; }
    const rgba = brush.getImageData(0, 0, size, size).data;
    let left = size, top = size, right = -1, bottom = -1;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (rgba[(y * size + x) * 4 + 3]) {
        if (x < left) left = x; if (x > right) right = x;
        if (y < top) top = y; if (y > bottom) bottom = y;
      }
    }
    if (right < left) { left = top = 0; right = bottom = 0; }
    // Two clear texels preserve bilinear filtering at the original cutout edge.
    left = Math.max(0, left - 2); top = Math.max(0, top - 2);
    right = Math.min(size - 1, right + 2); bottom = Math.min(size - 1, bottom + 2);
    const canvas = createScratchCanvas(right - left + 1, bottom - top + 1);
    canvas.getContext('2d')!.drawImage(source, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    const result = { canvas, x: left / density - 64, y: top / density - 64, density };
    const cost = canvas.width * canvas.height;
    while (this.entries.size && (this.entries.size >= this.limit || this.pixels + cost > this.budget)) {
      const oldest = this.entries.keys().next().value!;
      const old = this.entries.get(oldest)!;
      this.pixels -= old.canvas.width * old.canvas.height;
      this.entries.delete(oldest); this.evictions++;
    }
    // An oversized one-off image is still drawn, without displacing the budget
    // indefinitely or pretending it is a retained cache entry.
    if (cost <= this.budget) { this.entries.set(id, result); this.pixels += cost; }
    return result;
  }
  stats() { return { entries: this.entries.size, pixels: this.pixels, bytes: this.pixels * 4, hits: this.hits, misses: this.misses, evictions: this.evictions }; }
  clear() { this.entries.clear(); this.pixels = 0; this.scratch = undefined; this.hits = this.misses = this.evictions = 0; }
}
