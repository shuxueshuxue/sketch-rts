import { describe, expect, it } from 'vitest';
import { longFrameCause } from './perf-overlay';

describe('longFrameCause', () => {
  const frame = { start: 1000, end: 1080, js: 5 };
  it('blames the CPU when a long-animation-frame overlaps the gap', () => {
    expect(longFrameCause(frame, [{ start: 1010, end: 1070, script: 50, layout: 5, render: 8 }])).toBe('CPU');
  });
  it('blames the CPU when the game frame itself took most of the gap', () => {
    expect(longFrameCause({ ...frame, js: 60 }, [])).toBe('CPU');
  });
  it('blames the GPU or compositor when the main thread was idle across the gap', () => {
    expect(longFrameCause(frame, [{ start: 800, end: 900, script: 80, layout: 0, render: 5 }])).toBe('GPU');
    // A long-animation-frame that only waited (a frame held back by the GPU is still reported as long) is not CPU work.
    expect(longFrameCause(frame, [{ start: 1000, end: 1080, script: 0, layout: 0, render: 2 }])).toBe('GPU');
  });
});
