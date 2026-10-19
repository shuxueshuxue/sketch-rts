import * as THREE from 'three';

/** A WebGL2 context for card tests that executes blits as GL defines them: rectangles by their start and end corners,
 * from one level of a texture to one level and layer of another (see @@@card-window-blit). A canvas texture's levels
 * are its pixels, flipped as the browser uploads them (flipY) and box-filtered down a level at a time; what is blitted
 * is kept per texture, level and layer for a test to read back. */
export function fakeCardGl() {
  type Image = { width: number; height: number; data: Uint8ClampedArray };
  const stored = new Map<object, Map<string, Image>>();
  const blits: { source: object; sourceLevel: number; from: [number, number, number, number]; destination: object; level: number; layer: number; to: [number, number, number, number] }[] = [];
  let failure: ((blit: { destination: object; level: number }) => Error | undefined) | undefined;
  let read: { texture: object; level: number } | undefined, draw: { texture: object; level: number; layer: number } | undefined;
  const half = (image: Image): Image => {
    const width = Math.max(1, image.width >> 1), height = Math.max(1, image.height >> 1), data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 4; c++) {
      let sum = 0; for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) sum += image.data[((Math.min(image.height - 1, y * 2 + dy)) * image.width + Math.min(image.width - 1, x * 2 + dx)) * 4 + c]!;
      data[(y * width + x) * 4 + c] = Math.round(sum / 4);
    }
    return { width, height, data };
  };
  const sourceLevel = (texture: object, level: number): Image => {
    if (texture instanceof THREE.CanvasTexture) {
      const canvas = texture.image as HTMLCanvasElement, rows = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let image: Image = { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(rows.length) };
      for (let y = 0; y < canvas.height; y++) image.data.set(rows.subarray(y * canvas.width * 4, (y + 1) * canvas.width * 4), (canvas.height - 1 - y) * canvas.width * 4);
      for (let l = 0; l < level; l++) image = half(image);
      return image;
    }
    const image = stored.get(texture)?.get(`${level}:0`);
    if (!image) throw new Error('fake GL: blit from a level nothing was written to');
    return image;
  };
  const destinationLevel = (texture: object, level: number, layer: number): Image => {
    let levels = stored.get(texture); if (!levels) stored.set(texture, levels = new Map());
    let image = levels.get(`${level}:${layer}`);
    if (!image) {
      const mip = (texture as THREE.DataArrayTexture).mipmaps[level] as { width: number; height: number };
      levels.set(`${level}:${layer}`, image = { width: mip.width, height: mip.height, data: new Uint8ClampedArray(mip.width * mip.height * 4) });
    }
    return image;
  };
  const gl = {
    READ_FRAMEBUFFER: 0x8ca8, DRAW_FRAMEBUFFER: 0x8ca9, COLOR_ATTACHMENT0: 0x8ce0, TEXTURE_2D: 0x0de1, COLOR_BUFFER_BIT: 0x4000, NEAREST: 0x2600,
    createFramebuffer: () => ({}), deleteFramebuffer: () => {},
    framebufferTexture2D: (_target: number, _attachment: number, _kind: number, texture: object, level: number) => { read = { texture, level }; },
    framebufferTextureLayer: (_target: number, _attachment: number, texture: object, level: number, layer: number) => { draw = { texture, level, layer }; },
    blitFramebuffer: (sx0: number, sy0: number, sx1: number, sy1: number, dx0: number, dy0: number, dx1: number, dy1: number) => {
      if (!read || !draw) throw new Error('fake GL: blit without both framebuffers attached');
      const failed = failure?.({ destination: draw.texture, level: draw.level }); if (failed) throw failed;
      if (sx1 - sx0 !== dx1 - dx0 || sy1 - sy0 !== dy1 - dy0) throw new Error(`fake GL: a scaling blit ${[sx0, sy0, sx1, sy1]} -> ${[dx0, dy0, dx1, dy1]}`);
      blits.push({ source: read.texture, sourceLevel: read.level, from: [sx0, sy0, sx1, sy1], destination: draw.texture, level: draw.level, layer: draw.layer, to: [dx0, dy0, dx1, dy1] });
      const from = sourceLevel(read.texture, read.level), to = destinationLevel(draw.texture, draw.level, draw.layer);
      if (sx0 < 0 || sy0 < 0 || sx1 > from.width || sy1 > from.height || dx0 < 0 || dy0 < 0 || dx1 > to.width || dy1 > to.height) throw new Error('fake GL: a blit outside its textures');
      for (let y = 0; y < sy1 - sy0; y++) to.data.set(from.data.subarray(((sy0 + y) * from.width + sx0) * 4, ((sy0 + y) * from.width + sx1) * 4), ((dy0 + y) * to.width + dx0) * 4);
    },
  };
  return {
    blits,
    /** Release this test's pixels, texture references and injected failure. */
    reset: () => {
      stored.clear(); blits.length = 0; failure = undefined;
      read = undefined; draw = undefined;
    },
    /** Makes the blits this returns an error for throw it (a lost context, a failed transfer); undefined stops. */
    fail: (when: typeof failure) => { failure = when; },
    /** What one level and layer of a texture holds (texels from its bottom-left corner), or undefined if never written. */
    texels: (texture: object, level: number, layer: number) => stored.get(texture)?.get(`${level}:${layer}`),
    renderer: { getContext: () => gl as unknown as WebGL2RenderingContext, state: { bindFramebuffer: () => true }, properties: { get: (texture: object) => ({ __webglTexture: texture }) } },
  };
}
