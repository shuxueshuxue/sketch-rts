// Offscreen canvases the painters cache sprites and tiles in. The browser makes them from the document; a host without
// a document (the headless recorder) installs its own factory first.
export type ScratchCanvasFactory = (width: number, height: number) => HTMLCanvasElement;

let factory: ScratchCanvasFactory | undefined;

export function setScratchCanvasFactory(next: ScratchCanvasFactory | undefined) {
  factory = next;
}

export function createScratchCanvas(width: number, height: number): HTMLCanvasElement {
  if (factory) return factory(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
