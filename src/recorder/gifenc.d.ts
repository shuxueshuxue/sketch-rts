// gifenc ships no types. Its CommonJS module.exports is the object declared as the default export here.
declare module "gifenc" {
  type Rgba = Uint8Array | Uint8ClampedArray;
  type Format = "rgb565" | "rgb444" | "rgba4444";
  export type Palette = number[][];
  export type GifFrameOptions = {
    palette?: Palette;
    /** Milliseconds this frame stays up. */
    delay?: number;
    /** -1 plays once, 0 loops forever. */
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
    first?: boolean;
  };
  export type GifEncoder = {
    writeFrame(index: Uint8Array, width: number, height: number, options?: GifFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    reset(): void;
  };
  const gifenc: {
    GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): GifEncoder;
    quantize(rgba: Rgba, maxColors: number, options?: { format?: Format }): Palette;
    applyPalette(rgba: Rgba, palette: Palette, format?: Format): Uint8Array;
  };
  export default gifenc;
}
