/** Exact UTF-8 size of the observation ledger's JSON records, without building
 * either a JSON string or an encoded buffer. Ledger values are plain records,
 * arrays and JSON primitives; no custom toJSON hooks or cyclic values. */
export function observationJsonBytes(value: unknown): number {
  if (value === null) return 4;
  switch (typeof value) {
    case 'string': return quotedBytes(value);
    case 'number': return Number.isFinite(value) ? String(value).length : 4;
    case 'boolean': return value ? 4 : 5;
    case 'bigint': throw new TypeError('Observation JSON cannot contain a bigint');
    case 'object': {
      if (Array.isArray(value)) {
        let size = 2 + Math.max(0, value.length - 1);
        for (const item of value) size += omitted(item) ? 4 : observationJsonBytes(item);
        return size;
      }
      let size = 2, count = 0;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        const item = (value as Record<string, unknown>)[key];
        if (omitted(item)) continue;
        size += quotedBytes(key) + 1 + observationJsonBytes(item) + (count++ > 0 ? 1 : 0);
      }
      return size;
    }
    default: return 0;
  }
}
function omitted(value: unknown) { return value === undefined || typeof value === 'function' || typeof value === 'symbol'; }
function quotedBytes(value: string): number {
  let size = 2;
  for (let index = 0; index < value.length; index++) {
    const c = value.charCodeAt(index);
    if (c === 34 || c === 92 || c === 8 || c === 9 || c === 10 || c === 12 || c === 13) size += 2;
    else if (c < 32) size += 6;
    else if (c < 128) size++;
    else if (c < 2048) size += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { size += 4; index++; } else size += 6;
    } else size += c >= 0xdc00 && c <= 0xdfff ? 6 : 3;
  }
  return size;
}
