/** Coordinate-addressed noise. Sampling order and chunk boundaries have no effect. */
export function seedHash(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function coordinateRandom(seed: number, x: number, y: number, channel = 0): number {
  let hash = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(channel, 1274126177);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smooth value noise, in [0,1]; wavelengths are world distances, never ticks. */
export function spatialNoise(seed: number, x: number, y: number, wavelength: number, channel = 0): number {
  const px = x / wavelength, py = y / wavelength, col = Math.floor(px), row = Math.floor(py);
  const u = fade(px - col), v = fade(py - row);
  return mix(
    mix(coordinateRandom(seed, col, row, channel), coordinateRandom(seed, col + 1, row, channel), u),
    mix(coordinateRandom(seed, col, row + 1, channel), coordinateRandom(seed, col + 1, row + 1, channel), u), v,
  );
}

export function fractalNoise(seed: number, x: number, y: number, wavelength: number, channel = 0): number {
  return spatialNoise(seed, x, y, wavelength, channel) * .65
    + spatialNoise(seed, x, y, wavelength / 2, channel + 1) * .25
    + spatialNoise(seed, x, y, wavelength / 4, channel + 2) * .1;
}
