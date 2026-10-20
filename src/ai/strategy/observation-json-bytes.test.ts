import { describe, expect, it } from 'vitest';
import { observationJsonBytes } from './observation-json-bytes';

describe('observation JSON allocation-free size', () => {
  it('agrees with actual UTF-8 JSON, including escapes, Unicode, lone surrogates and omitted fields', () => {
    const values = ['', 'ordinary', '\"\\/\b\t\n\f\r\u0001', '蓝宝😀\u2028\u2029', '\ud800', '\udfff', '\ud800x\udfff',
      null, true, false, 0, -0, 3.141592653589793, 1e-20, 1e30, Infinity, NaN,
      { id: 'island:蓝宝', missing: undefined, force: null, point: { x: 1234.567, y: -0 }, values: [undefined, null, '😀'] }];
    for (const value of values) expect(observationJsonBytes(value)).toBe(Buffer.byteLength(JSON.stringify(value)));
  });
  it('matches bounded nested ledger-shaped records across all control and surrogate code units', () => {
    const strings = Array.from({ length: 65536 }, (_, index) => String.fromCharCode(index)).join('');
    const value = { observation: { owner: 'p0', terrain: strings, fields: { land: [{ goal: { x: 1e-10, y: 100 }, work: 2048, readyTick: null }], sea: [] },
      history: { tick: 9999, assets: [], objectives: [{ id: 'defend', utility: { score: null } }] } } };
    expect(observationJsonBytes(value)).toBe(Buffer.byteLength(JSON.stringify(value)));
  });
});
