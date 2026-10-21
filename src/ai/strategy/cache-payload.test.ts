import { expect, it } from 'vitest';
import { readCachePayload, storeCachePayload } from './cache-payload';

it('losslessly retains repeated declarative evidence and restores independent objects through JSON', () => {
  const value = { id: 'an-exact-fact:'.repeat(1000), at: { x: 2.3333333333333335, y: -0.000001 }, yes: true, no: null,
    array: [{ object: 1 }, '$cacheString', 7] };
  const original = Array.from({ length: 100 }, () => structuredClone(value));
  const packed = storeCachePayload(original);
  expect(packed.packedEntries?.encoding).toBe('json-dag-deflate-v2');
  expect(JSON.stringify(packed).length).toBeLessThan(10000);
  const restored = readCachePayload(JSON.parse(JSON.stringify(packed))) as typeof original;
  expect(restored).toEqual(original);
  expect(JSON.stringify(restored)).toBe(JSON.stringify(original));
  restored[0]!.at.x = 9;
  expect(restored[1]!.at.x).toBe(value.at.x);
  expect(original[0]!.at.x).toBe(value.at.x);
});
